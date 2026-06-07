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
});
