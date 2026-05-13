/**
 * Tests for resolveSquad() — worktree-local and callsign resolution.
 *
 * Covers: local walk-up, callsign/env-var lookup, priority rules,
 * error behavior, typed reason codes, registry-path precedence,
 * malformed registry, callsign input validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveSquad } from '@bradygaster/squad-sdk/resolution-v2';
import { SquadError } from '@bradygaster/squad-sdk/adapter/errors';

const TMP = join(process.cwd(), `.test-resolution-v2-${randomBytes(4).toString('hex')}`);

function dir(...segments: string[]): string {
  return join(TMP, ...segments);
}

function scaffold(...paths: string[]): void {
  for (const p of paths) {
    mkdirSync(dir(p), { recursive: true });
  }
}

function writeRegistry(filePath: string, squads: Array<{ callsign?: string; path: string }>): void {
  const registry = { version: 1, squads };
  writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf8');
}

/** Capture a thrown SquadError; fail if nothing was thrown or wrong type. */
function catchSquadError(fn: () => unknown): SquadError {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SquadError);
  return err as SquadError;
}

function errorCode(err: SquadError): unknown {
  return err.context.metadata?.['code'];
}

// ---------------------------------------------------------------------------
// Worktree-local resolution
// ---------------------------------------------------------------------------

describe('resolveSquad() — worktree-local resolution', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('2.1 returns git-root .squad/ when no callsign and no registry', () => {
    scaffold('.git', '.squad');
    const result = resolveSquad({ cwd: TMP, env: {} });
    expect(result).not.toBeNull();
    expect(result?.path).toBe(dir('.squad'));
    expect(result?.source).toBe('local');
  });

  it('2.2 returns worktree-local even when registry has a matching origin', () => {
    scaffold('.git', '.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'some-team', path: dir('other', '.squad') }]);
    const result = resolveSquad({ cwd: TMP, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('local');
    expect(result?.path).toBe(dir('.squad'));
  });

  it('2.3 walks to git-root when CWD is a subdirectory', () => {
    scaffold('.git', '.squad', 'packages', 'packages/app');
    const result = resolveSquad({ cwd: dir('packages', 'app'), env: {} });
    expect(result).not.toBeNull();
    expect(result?.path).toBe(dir('.squad'));
  });

  it('2.4 falls through when no .squad/ found at git-root', () => {
    scaffold('.git', 'src');
    const result = resolveSquad({ cwd: TMP, env: {} });
    expect(result).toBeNull();
  });

  it('2.5 ignores .squad that is a file rather than a directory', () => {
    scaffold('.git');
    writeFileSync(dir('.squad'), 'not-a-directory');
    const result = resolveSquad({ cwd: TMP, env: {} });
    expect(result).toBeNull();
  });

  it('2.6 resolves when CWD is a subdirectory of the git root', () => {
    scaffold('.git', '.squad', 'packages', 'packages/lib', 'packages/lib/src');
    const result = resolveSquad({ cwd: dir('packages', 'lib', 'src'), env: {} });
    expect(result).not.toBeNull();
    expect(result?.path).toBe(dir('.squad'));
  });

  it('Step 2 returns ResolvedSquad with source="local"', () => {
    scaffold('.git', '.squad');
    const result = resolveSquad({ cwd: TMP, env: {} });
    expect(result).toMatchObject({ path: dir('.squad'), source: 'local', matchedOrigin: null });
    expect(result?.callsign).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Callsign resolution (SQUAD_CALLSIGN env var + opts.callsign flag)
// ---------------------------------------------------------------------------

describe('resolveSquad() — callsign resolution (SQUAD_CALLSIGN env var)', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('1.1 returns entry path when callsign matches registry entry', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'alpha', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'alpha' },
      registryPath: registryFile,
    });
    expect(result?.path).toBe(dir('team', '.squad'));
    expect(result?.source).toBe('env');
    expect(result?.callsign).toBe('alpha');
  });

  it('1.2 throws SquadError with UNKNOWN_CALLSIGN when callsign set but no matching entry', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'alpha', path: dir('team', '.squad') }]);

    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'beta' }, registryPath: registryFile }),
    );
    expect(errorCode(err)).toBe('UNKNOWN_CALLSIGN');
  });

  it('1.3 throws SquadError with REGISTRY_MISSING when callsign set but registry missing', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({
        cwd: TMP,
        env: { SQUAD_CALLSIGN: 'alpha' },
        registryPath: dir('nonexistent', 'registry.json'),
      }),
    );
    expect(errorCode(err)).toBe('REGISTRY_MISSING');
  });

  it('1.4 throws SquadError with STALE_PATH when callsign resolves but path does not exist on disk', () => {
    scaffold('.git', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'alpha', path: dir('missing', '.squad') }]);

    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'alpha' }, registryPath: registryFile }),
    );
    expect(errorCode(err)).toBe('STALE_PATH');
  });

  it('1.5 worktree-local .squad/ wins over SQUAD_CALLSIGN when both present', () => {
    scaffold('.git', '.squad', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'alpha', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'alpha' },
      registryPath: registryFile,
    });
    expect(result?.source).toBe('local');
    expect(result?.path).toBe(dir('.squad'));
  });

  it('1.6 throws SquadError with EMPTY_CALLSIGN when SQUAD_CALLSIGN is empty string', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: '' } }),
    );
    expect(errorCode(err)).toBe('EMPTY_CALLSIGN');
  });

  it('1.7 throws SquadError with EMPTY_CALLSIGN when opts.callsign is empty string', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: {}, callsign: '' }),
    );
    expect(errorCode(err)).toBe('EMPTY_CALLSIGN');
  });

  it('Step 1 returns ResolvedSquad with source="env"', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'bravo', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'bravo' },
      registryPath: registryFile,
    });
    expect(result).toMatchObject({ source: 'env', callsign: 'bravo', matchedOrigin: null });
    expect(result?.path).toBe(dir('team', '.squad'));
  });
});

// ---------------------------------------------------------------------------
// Priority rules
// ---------------------------------------------------------------------------

describe('resolveSquad() — priority rules', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('--callsign flag wins over SQUAD_CALLSIGN env var when both provided', () => {
    scaffold('.git', 'team-a', 'team-a/.squad', 'team-b', 'team-b/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [
      { callsign: 'alpha', path: dir('team-a', '.squad') },
      { callsign: 'beta', path: dir('team-b', '.squad') },
    ]);

    const result = resolveSquad({
      cwd: TMP,
      callsign: 'beta',
      env: { SQUAD_CALLSIGN: 'alpha' },
      registryPath: registryFile,
    });
    expect(result?.path).toBe(dir('team-b', '.squad'));
    expect(result?.callsign).toBe('beta');
  });

  it('SQUAD_CALLSIGN resolves via registry when no local .squad/ present', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'gamma', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'gamma' },
      registryPath: registryFile,
    });
    expect(result?.source).toBe('env');
    expect(result?.callsign).toBe('gamma');
  });

  it('--callsign flag wins over worktree-local .squad/', () => {
    scaffold('.git', '.squad', 'explicit', 'explicit/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'delta', path: dir('explicit', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      callsign: 'delta',
      registryPath: registryFile,
    });
    expect(result?.path).toBe(dir('explicit', '.squad'));
    expect(result?.source).toBe('env');
    expect(result?.callsign).toBe('delta');
  });

  it('three-way: explicit callsign wins over local .squad/ and SQUAD_CALLSIGN simultaneously', () => {
    scaffold('.git', '.squad', 'explicit', 'explicit/.squad', 'env-team', 'env-team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [
      { callsign: 'env-sig', path: dir('env-team', '.squad') },
      { callsign: 'flag-sig', path: dir('explicit', '.squad') },
    ]);

    const result = resolveSquad({
      cwd: TMP,
      callsign: 'flag-sig',
      env: { SQUAD_CALLSIGN: 'env-sig' },
      registryPath: registryFile,
    });
    expect(result?.callsign).toBe('flag-sig');
    expect(result?.path).toBe(dir('explicit', '.squad'));
    expect(result?.source).toBe('env');
  });
});

// ---------------------------------------------------------------------------
// Registry-path precedence
// ---------------------------------------------------------------------------

describe('resolveSquad() — registry-path precedence', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('resolves registry from SQUAD_REGISTRY_PATH env when opts.registryPath is absent', () => {
    scaffold('.git', 'team', 'team/.squad', 'env-reg');
    const envRegistryFile = dir('env-reg', 'registry.json');
    writeRegistry(envRegistryFile, [{ callsign: 'echo', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'echo', SQUAD_REGISTRY_PATH: envRegistryFile },
    });
    expect(result?.callsign).toBe('echo');
    expect(result?.path).toBe(dir('team', '.squad'));
  });

  it('resolves registry from platform default path when neither opts.registryPath nor SQUAD_REGISTRY_PATH is set', () => {
    scaffold('.git', 'team', 'team/.squad', 'fake-home/.config/squad');
    const defaultRegistryFile = dir('fake-home', '.config', 'squad', 'registry.json');
    writeRegistry(defaultRegistryFile, [{ callsign: 'foxtrot', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      platform: 'linux',
      homeDir: dir('fake-home'),
      env: { SQUAD_CALLSIGN: 'foxtrot' },
    });
    expect(result?.callsign).toBe('foxtrot');
    expect(result?.path).toBe(dir('team', '.squad'));
  });

  it('opts.registryPath wins over SQUAD_REGISTRY_PATH env over platform default', () => {
    scaffold(
      '.git',
      'team-correct',
      'team-correct/.squad',
      'team-env',
      'team-env/.squad',
      'team-default',
      'team-default/.squad',
      'reg-explicit',
      'reg-env',
      'fake-home/.config/squad',
    );
    const explicitReg = dir('reg-explicit', 'registry.json');
    const envReg = dir('reg-env', 'registry.json');
    const defaultReg = dir('fake-home', '.config', 'squad', 'registry.json');

    writeRegistry(explicitReg, [{ callsign: 'winner', path: dir('team-correct', '.squad') }]);
    writeRegistry(envReg, [{ callsign: 'winner', path: dir('team-env', '.squad') }]);
    writeRegistry(defaultReg, [{ callsign: 'winner', path: dir('team-default', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'winner', SQUAD_REGISTRY_PATH: envReg },
      registryPath: explicitReg,
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result?.path).toBe(dir('team-correct', '.squad'));
  });
});

// ---------------------------------------------------------------------------
// Malformed registry
// ---------------------------------------------------------------------------

describe('resolveSquad() — malformed registry', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('throws SquadError with REGISTRY_INVALID for truncated JSON', () => {
    scaffold('.git', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeFileSync(registryFile, '{"squads":[', 'utf8');

    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'alpha' }, registryPath: registryFile }),
    );
    expect(errorCode(err)).toBe('REGISTRY_INVALID');
  });

  it('throws SquadError with REGISTRY_INVALID for BOM-prefixed JSON', () => {
    scaffold('.git', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeFileSync(registryFile, '\uFEFF' + JSON.stringify({ version: 1, squads: [] }), 'utf8');

    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'alpha' }, registryPath: registryFile }),
    );
    expect(errorCode(err)).toBe('REGISTRY_INVALID');
  });

  it('throws SquadError with REGISTRY_INVALID for wrong schema (squads not an array)', () => {
    scaffold('.git', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeFileSync(registryFile, JSON.stringify({ version: 1, squads: 'not-an-array' }), 'utf8');

    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'alpha' }, registryPath: registryFile }),
    );
    expect(errorCode(err)).toBe('REGISTRY_INVALID');
  });
});

// ---------------------------------------------------------------------------
// Callsign input validation (character-set)
// ---------------------------------------------------------------------------

describe('resolveSquad() — callsign input validation', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('throws SquadError with INVALID_CALLSIGN for opts.callsign with illegal characters', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: {}, callsign: 'bad/callsign' }),
    );
    expect(errorCode(err)).toBe('INVALID_CALLSIGN');
  });

  it('throws SquadError with INVALID_CALLSIGN for SQUAD_CALLSIGN env var with illegal characters', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'bad callsign!' } }),
    );
    expect(errorCode(err)).toBe('INVALID_CALLSIGN');
  });

  it('accepts callsigns with letters, digits, hyphens, and underscores', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'my-team_01', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'my-team_01' },
      registryPath: registryFile,
    });
    expect(result?.callsign).toBe('my-team_01');
  });
});
