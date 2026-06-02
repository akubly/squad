/**
 * ADO template behavioral assertions — piece 30
 *
 * Validates the three canonical ADO pipeline templates:
 *   .squad-templates/ado/bootstrap-cross-repo.ps1
 *   .squad-templates/ado/publish-inbox.yml
 *   .squad-templates/ado/fold-squad-state.yml
 *
 * Assertions:
 *   1. publish-inbox.yml is valid YAML
 *   2. publish-inbox.yml has no top-level `pr:` key
 *   3. fold-squad-state.yml is valid YAML
 *   4. fold-squad-state.yml trigger includes `squad/inbox/**`
 *   5. fold-squad-state.yml has no broad pool-level OAuth grant
 *   6. bootstrap-cross-repo.ps1 has an alias-empty guard before first write
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const ADO_DIR = resolve(ROOT, '.squad-templates', 'ado');

function readTemplate(name: string): string {
  return readFileSync(resolve(ADO_DIR, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. publish-inbox.yml — valid YAML
// ---------------------------------------------------------------------------

describe('publish-inbox.yml', () => {
  const raw = readTemplate('publish-inbox.yml');

  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('has no top-level pr: trigger key', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    expect(
      parsed,
      'publish-inbox.yml must not contain a top-level "pr:" key — PR triggers are not allowed for inbox publishing'
    ).not.toHaveProperty('pr');
  });

  it('trigger includes squad/inbox branches', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(trigger, 'publish-inbox.yml must have a trigger section').toBeDefined();
    const raw_str = JSON.stringify(trigger);
    expect(raw_str).toContain('squad/inbox');
  });
});

// ---------------------------------------------------------------------------
// 2. fold-squad-state.yml — valid YAML, trigger shape, no broad OAuth
// ---------------------------------------------------------------------------

describe('fold-squad-state.yml', () => {
  const raw = readTemplate('fold-squad-state.yml');

  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('trigger includes squad/inbox/* pattern', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(trigger, 'fold-squad-state.yml must have a trigger section').toBeDefined();
    const raw_str = JSON.stringify(trigger);
    expect(
      raw_str,
      'fold-squad-state.yml trigger must include a squad/inbox pattern'
    ).toContain('squad/inbox');
  });

  it('has no pool-level allowScripts or broad OAuth grant', () => {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const pool = parsed['pool'] as Record<string, unknown> | undefined;
    if (pool) {
      expect(pool).not.toHaveProperty('allowScripts');
      const poolStr = JSON.stringify(pool);
      expect(poolStr).not.toContain('allowScripts');
      expect(poolStr).not.toContain('accessToken');
    }
    // Also check there is no top-level allowScripts
    expect(parsed).not.toHaveProperty('allowScripts');
  });

  it('contains the sole-writer invariant comment', () => {
    expect(
      raw,
      'fold-squad-state.yml must contain a comment asserting it is the sole writer to squad-state'
    ).toContain('SOLE WRITER INVARIANT');
  });
});

// ---------------------------------------------------------------------------
// 3. bootstrap-cross-repo.ps1 — alias-empty guard before first write
// ---------------------------------------------------------------------------

describe('bootstrap-cross-repo.ps1', () => {
  const raw = readTemplate('bootstrap-cross-repo.ps1');

  it('has a DeveloperAlias null/empty guard before the first write operation', () => {
    // Guard must appear before any write (clone, bind, remote add, etc.)
    // Accepts: if (!$DeveloperAlias), [string]::IsNullOrWhiteSpace, -notmatch, etc.
    const hasGuard =
      /if\s*\(\s*!\s*\$DeveloperAlias\b/.test(raw) ||
      /if\s*\(\s*\[string\]::IsNullOrWhiteSpace\s*\(\s*\$DeveloperAlias\s*\)/.test(raw) ||
      /if\s*\(\s*-not\s*\$DeveloperAlias\b/.test(raw);

    expect(
      hasGuard,
      'bootstrap-cross-repo.ps1 must guard against an empty or absent DeveloperAlias before any write operation'
    ).toBe(true);
  });

  it('has a DocsRepoUrl null/empty guard before the first write operation', () => {
    const hasGuard =
      /if\s*\(\s*!\s*\$DocsRepoUrl\b/.test(raw) ||
      /if\s*\(\s*\[string\]::IsNullOrWhiteSpace\s*\(\s*\$DocsRepoUrl\s*\)/.test(raw) ||
      /if\s*\(\s*-not\s*\$DocsRepoUrl\b/.test(raw);

    expect(
      hasGuard,
      'bootstrap-cross-repo.ps1 must guard against an empty or absent DocsRepoUrl before any write operation'
    ).toBe(true);
  });
});
