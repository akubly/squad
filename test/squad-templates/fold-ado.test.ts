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
  '# This pipeline is the sole writer to squad-state. No other automation or manual push should target this branch.';

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

  it('does NOT have a schedules: key', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('schedules');
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
});
