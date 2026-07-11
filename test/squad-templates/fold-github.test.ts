/**
 * Behavioral assertions for the GitHub Actions fold-squad-state.yml template.
 *
 * Verifies trigger shape, permissions, invariant comment, push guard, and
 * absence of disallowed trigger types.
 */

import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  '.squad-templates',
  'fold',
  'github',
  'fold-squad-state.yml',
);

const SINGLE_WRITER_COMMENT =
  '# This pipeline is the sole writer to squad/state/<callsign>. No other automation or manual push should target these branches.';

const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

describe('fold-squad-state.yml (GitHub Actions)', () => {
  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('has on.push.branches including squad/inbox/**', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown> | undefined;
    expect(on).toBeDefined();
    const push = (on as Record<string, unknown>)['push'] as Record<string, unknown> | undefined;
    expect(push).toBeDefined();
    const branches = (push as Record<string, unknown>)['branches'] as string[] | undefined;
    expect(branches).toBeDefined();
    expect(branches).toContain('squad/inbox/**');
  });

  it('does NOT have a top-level pull_request: trigger key', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('pull_request');
  });

  it('does NOT have a top-level pr: key', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('pr');
  });

  it('has permissions.contents === write', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const permissions = parsed['permissions'] as Record<string, unknown> | undefined;
    expect(permissions).toBeDefined();
    expect(permissions!['contents']).toBe('write');
  });

  it('has permissions.actions === read', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const permissions = parsed['permissions'] as Record<string, unknown> | undefined;
    expect(permissions!['actions']).toBe('read');
  });

  it('contains the verbatim single-writer invariant comment', () => {
    expect(raw).toContain(SINGLE_WRITER_COMMENT);
  });

  it('contains --force-with-lease on the push step', () => {
    expect(raw).toContain('--force-with-lease');
  });

  it('deletes only successfully-folded refs, driven by FOLDED_ENTRIES not the full discovered set (piece 48 B)', () => {
    // The cleanup loop must iterate the successfully-folded refs, never $SORTED_REFS,
    // so a ref whose fold commit failed is never deleted unfolded.
    expect(raw).toContain("FOLDED_REF_LIST=$(echo \"$FOLDED_ENTRIES\" | jq -r '.[].ref' | tr -d '\\r')");
    expect(raw).toContain('done <<< "$FOLDED_REF_LIST"');
    // The fold loop still iterates $SORTED_REFS exactly once; the delete loop no longer does.
    expect(raw.split('done <<< "$SORTED_REFS"').length - 1).toBe(1);
  });

  it('strips carriage returns from every refspec-feeding pipeline so a CRLF runner never emits an invalid refspec (piece 50 B)', () => {
    // The --delete-folded-refs cleanup loop is CR-safe: the jq output is CR-stripped and
    // each read ref is defensively trimmed of a trailing CR before it becomes a refspec.
    expect(raw).toContain("FOLDED_REF_LIST=$(echo \"$FOLDED_ENTRIES\" | jq -r '.[].ref' | tr -d '\\r')");
    expect(raw).toContain("REF=\"${REF%$'\\r'}\"");
    // The other refspec-feeding pipelines strip CR too (recorded-ref scan + inbox discovery).
    expect(raw).toContain("jq -r '.[].foldedRefs[].ref // empty' \"$HISTORY_FILE\" 2>/dev/null | tr -d '\\r'");
    expect(raw).toContain("git ls-remote --heads origin \"refs/heads/squad/inbox/${CALLSIGN}/*\" | awk '{print $2}' | tr -d '\\r'");
  });

  it('keeps the inbox-branch cleanup gated off by default (DELETE_FOLDED_REFS:-false) (piece 48 B)', () => {
    expect(raw).toContain('if [ "${DELETE_FOLDED_REFS:-false}" = "true" ]; then');
  });

  it('discovers distinct callsigns at run time from live inbox refs', () => {
    expect(raw).toContain("git ls-remote --heads origin 'refs/heads/squad/inbox/*'");
    expect(raw).toContain("sed -nE 's#^[0-9a-f]+\\srefs/heads/squad/inbox/([^/]+)/.*#\\1#p'");
    expect(raw).toContain('sort -u');
  });

  it('validates discovered callsigns before using them as branch path components', () => {
    expect(raw).toContain('^[a-z][a-z0-9-]{1,38}$');
    expect(raw).toContain('WARNING: Skipping invalid callsign');
  });

  it('folds into per-callsign state branches, not a flat squad-state branch', () => {
    expect(raw).toContain('squad/state/$CALLSIGN');
    expect(raw).toContain('HEAD:refs/heads/${STATE_BRANCH}');
    expect(raw).not.toContain('refs/heads/squad-state');
    expect(raw).not.toContain('HEAD:refs/heads/squad-state');
  });

  it('does not contain git merge (uses git read-tree for folding)', () => {
    // Folding must use git read-tree, not git merge
    expect(raw).not.toMatch(/\bgit merge\b/);
  });

  it('does not contain external product names in comments', () => {
    // Generic terms only: "Squad fold pipeline", "Squad inbox branch", "Squad state branch"
    const disallowed = ['GitHub Actions', 'Azure DevOps', 'Azure Pipelines'];
    for (const name of disallowed) {
      expect(raw).not.toContain(name);
    }
  });

  it('has a schedule trigger with 15-minute cron fallback (A)', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('schedule');
    const schedule = on['schedule'] as Array<Record<string, unknown>>;
    expect(Array.isArray(schedule)).toBe(true);
    const crons = schedule.map(s => s['cron'] as string);
    expect(crons).toContain('*/15 * * * *');
  });

  it('has a git identity configuration step (B)', () => {
    expect(raw).toContain('git config user.email "squad-fold@noreply"');
    expect(raw).toContain('git config user.name "Squad Fold Pipeline"');
    // Identity step must appear before first actual git commit command (not comment)
    const identityIdx = raw.indexOf('git config user.email "squad-fold@noreply"');
    // Find first real commit: 'git commit --allow-empty' or 'git commit \'  (multiline)
    const commitIdx = raw.search(/\bgit commit\s+(?:--allow-empty|-m)/);
    expect(identityIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeLessThan(commitIdx);
  });

  it('overlays the inbox .squad tree with git archive | tar, not read-tree --prefix (A)', () => {
    expect(raw).toContain('git archive refs/fold-tmp/inbox .squad');
    expect(raw).toContain("tar -x --exclude='.squad/publish-history.json'");
    // The bind-style placement must be gone — it fails on a populated .squad/.
    expect(raw).not.toContain('git read-tree --prefix=.squad/');
    expect(raw).not.toContain('git rm -r --cached .squad/');
  });

  it('excludes the pipeline-owned publish-history.json from the inbox overlay (A)', () => {
    expect(raw).toContain("--exclude='.squad/publish-history.json'");
  });

  it('still resolves and guards on INBOX_SQUAD_TREE before the overlay (A)', () => {
    expect(raw).toContain('INBOX_SQUAD_TREE=$(git ls-tree refs/fold-tmp/inbox .squad');
    expect(raw).toContain('No .squad/ subtree in $REF — skipping.');
  });

  it('leaves run serialization to the piece-41 concurrency group (B leaves GitHub unchanged)', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const concurrency = parsed['concurrency'] as Record<string, unknown> | undefined;
    expect(concurrency).toBeDefined();
    expect(concurrency!['group']).toBe('fold-squad-state');
    expect(concurrency!['cancel-in-progress']).toBe(false);
  });

  it('does not inline GitHub expression outputs into shell assignments (SEC-1)', () => {
    expect(raw).not.toContain('${{ steps.fold.outputs.folded_entries }}');
    expect(raw).not.toContain('${{ steps.fold.outputs.final_sha }}');
    expect(raw).not.toMatch(/FOLDED_ENTRIES=['"].*\$\{\{/);
  });

  it('drops a stale local state branch before the checkout block (piece 49 A1)', () => {
    const detachIdx = raw.indexOf('git checkout --detach >/dev/null 2>&1 || true');
    const branchDIdx = raw.indexOf('git branch -D "$STATE_BRANCH" >/dev/null 2>&1 || true');
    const checkoutIdx = raw.indexOf('if git ls-remote --exit-code origin "refs/heads/${STATE_BRANCH}"');
    expect(detachIdx).toBeGreaterThan(-1);
    expect(branchDIdx).toBeGreaterThan(-1);
    expect(checkoutIdx).toBeGreaterThan(-1);
    expect(detachIdx).toBeLessThan(checkoutIdx);
    expect(branchDIdx).toBeLessThan(checkoutIdx);
  });

  it('guards the per-ref commit with git diff --cached --quiet (piece 49 A2)', () => {
    expect(raw).toContain('if git diff --cached --quiet; then');
    expect(raw).toContain('already folded (no changes)');
  });

  it('has on.workflow_dispatch for manual triggering (piece 49 B)', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('retains push and schedule triggers alongside workflow_dispatch (piece 49 B)', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const on = parsed['on'] as Record<string, unknown>;
    expect(on).toHaveProperty('push');
    expect(on).toHaveProperty('schedule');
  });
});
