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
  '# This pipeline is the sole writer to squad-state. No other automation or manual push should target this branch.';

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

  it('fold loop has git rm --cached .squad/ before git read-tree (D)', () => {
    const rmIdx = raw.indexOf('git rm -r --cached .squad/ 2>/dev/null || true');
    const readTreeIdx = raw.indexOf('git read-tree --prefix=.squad/ -u');
    expect(rmIdx).toBeGreaterThan(-1);
    expect(readTreeIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeLessThan(readTreeIdx);
  });

  it('publish-history step uses env-binding for FOLDED_ENTRIES (SEC-1)', () => {
    // SEC-1 fix: ${{ }} expressions must be bound via the step env: block, never inlined
    // into the script body. GitHub expands ${{ }} at render time before bash runs.
    expect(raw).toContain('FOLDED_ENTRIES: ${{ steps.fold.outputs.folded_entries }}');
    expect(raw).toContain('FOLD_COMMIT_SHA: ${{ steps.fold.outputs.final_sha }}');
    // Inline assignments must not appear in the script body — any quote style.
    expect(raw).not.toContain("FOLDED_ENTRIES='${{ steps.fold.outputs.folded_entries }}'");
    expect(raw).not.toContain('FOLDED_ENTRIES="${{ steps.fold.outputs.folded_entries }}"');
    // Injection regression: no ${{ }} expression for folded_entries should be assigned inline
    // (catches break-out regardless of quote style — e.g., developerAlias with embedded quotes).
    expect(raw).not.toMatch(/FOLDED_ENTRIES=['"].*\$\{\{/);
  });
});
