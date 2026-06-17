/**
 * Behavioral assertions for the ADO Pipelines fold-squad-state.yml template.
 *
 * Verifies trigger shape, OAuth scoping, invariant comment, push guard,
 * absence of disallowed keys, and ADO $(…) expression safety (Gate 8).
 */

import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  '.squad-templates',
  'fold',
  'ado',
  'fold-squad-state.yml',
);

const SINGLE_WRITER_COMMENT =
  '# This pipeline is the sole writer to squad/state/<callsign>. No other automation or manual push should target these branches.';

const ADO_VAR_RE = /\$\(([^)]+)\)/g;
const SAFE_VAR_IDENT = /^[A-Za-z][A-Za-z0-9._]*$/;

const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

describe('fold-squad-state.yml (ADO Pipelines)', () => {
  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('trigger.branches.include contains refs/heads/squad/inbox/*', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(trigger).toBeDefined();
    const branches = (trigger as Record<string, unknown>)['branches'] as Record<string, unknown> | undefined;
    expect(branches).toBeDefined();
    const include = (branches as Record<string, unknown>)['include'] as string[] | undefined;
    expect(include).toBeDefined();
    expect(include).toContain('refs/heads/squad/inbox/*');
  });

  it('does NOT have a top-level pr: key', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('pr');
  });

  it('has a schedules: block with 15-minute cron fallback (A)', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty('schedules');
    const schedules = parsed['schedules'] as Array<Record<string, unknown>>;
    expect(Array.isArray(schedules)).toBe(true);
    expect(schedules.length).toBeGreaterThan(0);
    const crons = schedules.map(s => s['cron'] as string);
    expect(crons).toContain('*/15 * * * *');
    const fallback = schedules.find(s => s['cron'] === '*/15 * * * *')!;
    expect(fallback['always']).toBe(false);
  });

  it('does not have allowScripts: true at pool level', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const pool = parsed['pool'] as Record<string, unknown> | undefined;
    if (pool) {
      expect(pool).not.toHaveProperty('allowScripts');
    }
    expect(parsed).not.toHaveProperty('allowScripts');
  });

  it('contains the verbatim single-writer invariant comment', () => {
    expect(raw).toContain(SINGLE_WRITER_COMMENT);
  });

  it('contains --force-with-lease on the push step', () => {
    expect(raw).toContain('--force-with-lease');
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
    expect(raw).not.toMatch(/\bgit merge\b/);
  });

  it('all $(…) expressions match [A-Za-z][A-Za-z0-9._]* (Gate 8)', () => {
    const matches = [...raw.matchAll(ADO_VAR_RE)];
    for (const m of matches) {
      expect(m[1]).toMatch(SAFE_VAR_IDENT);
    }
  });

  it('does not contain external product names in comments', () => {
    const disallowed = ['GitHub Actions', 'Azure DevOps', 'Azure Pipelines'];
    for (const name of disallowed) {
      expect(raw).not.toContain(name);
    }
  });

  it('has a git identity bash step immediately after checkout (B)', () => {
    expect(raw).toContain('git config user.email "squad-fold@noreply"');
    expect(raw).toContain('git config user.name "Squad Fold Pipeline"');
    // Identity step must appear before first actual git commit command (not comments)
    const identityIdx = raw.indexOf('git config user.email "squad-fold@noreply"');
    const commitIdx = raw.search(/\bgit commit\s+(?:--allow-empty|-m|\\)/);
    expect(identityIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeLessThan(commitIdx);
  });

  it('does not inline ADO output macros into shell assignments (SEC-1)', () => {
    expect(raw).not.toContain('$(foldRefs.foldedEntries)');
    expect(raw).not.toContain('$(foldRefs.finalSha)');
    expect(raw).not.toMatch(/FOLDED_ENTRIES=['"].*\$\(foldRefs/);
  });

  it('fold loop has git rm --cached .squad/ before git read-tree (D)', () => {
    const rmIdx = raw.indexOf('git rm -r --cached .squad/ 2>/dev/null || true');
    const readTreeIdx = raw.indexOf('git read-tree --prefix=.squad/ -u');
    expect(rmIdx).toBeGreaterThan(-1);
    expect(readTreeIdx).toBeGreaterThan(-1);
    expect(rmIdx).toBeLessThan(readTreeIdx);
  });
});
