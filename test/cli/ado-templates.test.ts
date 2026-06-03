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
 *   3. publish-inbox.yml trigger has NO narrow include clause (CAPCOM M2 fix)
 *   4. publish-inbox.yml trigger excludes squad-state, main, dev
 *   5. publish-inbox.yml has persistCredentials: true (Booster M2 fix)
 *   6. fold-squad-state.yml is valid YAML
 *   7. fold-squad-state.yml trigger includes `squad/inbox/**`
 *   8. fold-squad-state.yml trigger has batch: true (Booster M1 fix)
 *   9. fold-squad-state.yml has no broad pool-level OAuth grant
 *  10. fold-squad-state.yml contains the sole-writer invariant comment
 *  11. fold-squad-state.yml does NOT contain `squad fold` (CAPCOM M1 regression guard)
 *  12. bootstrap-cross-repo.ps1 has an alias-empty guard before first write
 *  13. bootstrap-cross-repo.ps1 has a DocsRepoUrl null/empty guard before first write
 *  14. bootstrap-cross-repo.ps1 has URL-scheme allowlist validation (RETRO M3 fix)
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
// 1. publish-inbox.yml — valid YAML, no PR trigger, corrected trigger shape
// ---------------------------------------------------------------------------

describe('publish-inbox.yml', () => {
  const raw = readTemplate('publish-inbox.yml');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('has no top-level pr: trigger key', () => {
    expect(
      parsed,
      'publish-inbox.yml must not contain a top-level "pr:" key — PR triggers are not allowed for inbox publishing'
    ).not.toHaveProperty('pr');
  });

  it('trigger has NO narrow include clause (CAPCOM M2: inbox branches live in TEAM_ROOT, not WORK_ROOT)', () => {
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(trigger, 'publish-inbox.yml must have a trigger section').toBeDefined();
    const branches = (trigger as Record<string, unknown>)['branches'] as Record<string, unknown> | undefined;
    // After CAPCOM M2 fix: no include clause — triggers on all branches except excluded ones
    expect(
      branches,
      'publish-inbox.yml trigger must not have a narrow "include:" clause after CAPCOM M2 fix'
    ).not.toHaveProperty('include');
  });

  it('trigger excludes squad-state, main, and dev branches', () => {
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    const branches = (trigger as Record<string, unknown>)?.['branches'] as Record<string, unknown> | undefined;
    const exclude = (branches?.['exclude'] as string[]) ?? [];
    expect(exclude, 'publish-inbox.yml trigger must exclude squad-state').toContain('squad-state');
    expect(exclude, 'publish-inbox.yml trigger must exclude main').toContain('main');
    expect(exclude, 'publish-inbox.yml trigger must exclude dev').toContain('dev');
  });

  it('checkout step has persistCredentials: true (Booster M2 fix)', () => {
    const steps = parsed['steps'] as Array<Record<string, unknown>> | undefined;
    expect(steps, 'publish-inbox.yml must have steps').toBeDefined();
    const checkoutStep = steps?.find(
      (s) => typeof s['checkout'] === 'string' || s['checkout'] === 'self'
    );
    expect(checkoutStep, 'publish-inbox.yml must have a checkout: self step').toBeDefined();
    expect(
      checkoutStep?.['persistCredentials'],
      'publish-inbox.yml checkout must set persistCredentials: true so git push can authenticate'
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. fold-squad-state.yml — valid YAML, trigger shape, no broad OAuth, no squad fold
// ---------------------------------------------------------------------------

describe('fold-squad-state.yml', () => {
  const raw = readTemplate('fold-squad-state.yml');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  it('is valid YAML (parses without error)', () => {
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it('trigger includes squad/inbox/* pattern', () => {
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(trigger, 'fold-squad-state.yml must have a trigger section').toBeDefined();
    const raw_str = JSON.stringify(trigger);
    expect(
      raw_str,
      'fold-squad-state.yml trigger must include a squad/inbox pattern'
    ).toContain('squad/inbox');
  });

  it('trigger has batch: true (Booster M1 fix — serializes concurrent fold runs)', () => {
    const trigger = parsed['trigger'] as Record<string, unknown> | undefined;
    expect(
      trigger,
      'fold-squad-state.yml trigger must have batch: true to prevent concurrent non-fast-forward push races'
    ).toHaveProperty('batch', true);
  });

  it('has no pool-level allowScripts or broad OAuth grant', () => {
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

  it('contains the sole-writer invariant comment near the top', () => {
    // Invariant comment must appear within the first 15 lines (before any reader starts editing)
    const firstBlock = raw.split('\n').slice(0, 15).join('\n');
    expect(
      firstBlock,
      'fold-squad-state.yml must contain the SOLE WRITER INVARIANT comment within the first 15 lines'
    ).toContain('INVARIANT');
  });

  it('does NOT contain "squad fold" invocation (CAPCOM M1 regression guard)', () => {
    expect(
      raw,
      'fold-squad-state.yml must not call "squad fold" — fold logic is inlined as git plumbing per piece 28/30 spec'
    ).not.toMatch(/squad\s+fold\b/);
  });
});

// ---------------------------------------------------------------------------
// 3. bootstrap-cross-repo.ps1 — input validation guards, URL scheme allowlist
// ---------------------------------------------------------------------------

describe('bootstrap-cross-repo.ps1', () => {
  const raw = readTemplate('bootstrap-cross-repo.ps1');

  it('has a DeveloperAlias null/empty guard before the first write operation', () => {
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

  it('has URL-scheme allowlist validation (RETRO M3 fix — rejects file://, ftp://, etc.)', () => {
    // Must have a -notmatch check against allowed schemes (https://, http://, ssh://, git+ssh://, git@)
    const hasSchemeCheck = /\$DocsRepoUrl\s+-notmatch\s+['"]\^?\(https/.test(raw);
    expect(
      hasSchemeCheck,
      'bootstrap-cross-repo.ps1 must validate DocsRepoUrl scheme against an allowlist (https://, ssh://, git@) before git clone'
    ).toBe(true);
  });
});
