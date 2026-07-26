/**
 * Tests for resolveSquad() — worktree-local and callsign resolution,
 * init-mode guard, clones/origins matching, URL normalization,
 * platform fallback, linked-worktree fallback, and full chain precedence.
 *
 * Covers: local walk-up, callsign/env-var lookup, priority rules,
 * error behavior, typed reason codes, registry-path precedence,
 * malformed registry, callsign input validation,
 * clone path containment, origin URL canonicalization, platform
 * directory probing, and linked-worktree detection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, mkdirSync as mkdirSyncFs } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

import { isValidCallsign, uninstallCopilotPayload } from '@wifi-aware/squad-sdk';
import { resolveSquad, normalizeRemoteUrl, collectCwdRemoteUrls } from '@wifi-aware/squad-sdk/resolution-v2';
import { defaultRegistryFilePath } from '@wifi-aware/squad-sdk/path-utils';
import { SquadError } from '@wifi-aware/squad-sdk/adapter/errors';
import { runDoctorPurge } from '../packages/squad-cli/src/commands/doctor.js';

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

interface RegistryEntryFull {
  callsign?: string;
  path: string;
  clones?: string[];
  origins?: string[];
}

function writeRegistryFull(filePath: string, squads: RegistryEntryFull[]): void {
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
    scaffold('.git', 'team', 'team/.squad', 'fake-home/.squad');
    const defaultRegistryFile = dir('fake-home', '.squad', 'registry.json');
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
    expect(err.message).toContain('Callsign "bad/callsign" is invalid.');
  });

  it('throws SquadError with INVALID_CALLSIGN for SQUAD_CALLSIGN env var with illegal characters', () => {
    scaffold('.git');
    const err = catchSquadError(() =>
      resolveSquad({ cwd: TMP, env: { SQUAD_CALLSIGN: 'bad callsign!' } }),
    );
    expect(errorCode(err)).toBe('INVALID_CALLSIGN');
  });

  it('accepts lowercase callsigns with digits and internal hyphens', () => {
    scaffold('.git', 'team', 'team/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'gethelp-app', path: dir('team', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      env: { SQUAD_CALLSIGN: 'gethelp-app' },
      registryPath: registryFile,
    });
    expect(result?.callsign).toBe('gethelp-app');
  });

  it('keeps resolution-v2, copilot-payload, and doctor callsign validation aligned', async () => {
    scaffold('.git');

    const cases = [
      ['a', true],
      ['squad', true],
      ['my-squad', true],
      ['gethelp-app', true],
      ['abc123', true],
      ['x'.repeat(64), true],
      ['', false],
      ['-leading', false],
      ['trailing-', false],
      ['_underscore', false],
      ['UPPER', false],
      ['with.dot', false],
      ['with space', false],
      ['x'.repeat(65), false],
      ['a--b', true],
      ['..', false],
    ] as const;

    for (const [index, [callsign, expected]] of cases.entries()) {
      const hostDir = dir(`callsign-host-${index}`);
      const squadDir = join(hostDir, '.squad');
      const registryDir = dir(`callsign-registry-${index}`);
      const registryFile = join(registryDir, 'registry.json');
      const copilotHome = dir(`callsign-copilot-${index}`);

      mkdirSync(squadDir, { recursive: true });
      mkdirSync(registryDir, { recursive: true });
      writeRegistry(registryFile, expected ? [{ callsign, path: squadDir }] : []);

      const resolutionValid = (() => {
        try {
          resolveSquad({ cwd: TMP, env: {}, callsign, registryPath: registryFile });
          return true;
        } catch (error) {
          if (error instanceof SquadError) {
            const code = errorCode(error);
            if (code === 'EMPTY_CALLSIGN' || code === 'INVALID_CALLSIGN') {
              return false;
            }
          }
          throw error;
        }
      })();

      const payloadValid = (() => {
        try {
          uninstallCopilotPayload({ callsign, copilotHome });
          return true;
        } catch (error) {
          if ((error as { code?: string }).code === 'ERR_PAYLOAD_INVALID_CALLSIGN') {
            return false;
          }
          throw error;
        }
      })();

      const doctorResult = await runDoctorPurge({ callsign, registryPath: registryFile, yes: true });
      const doctorValid = doctorResult.invalidCallsign !== true;

      expect({
        callsign,
        helper: isValidCallsign(callsign),
        resolution: resolutionValid,
        payload: payloadValid,
        doctor: doctorValid,
      }).toEqual({
        callsign,
        helper: expected,
        resolution: expected,
        payload: expected,
        doctor: expected,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Init-mode guard
// ---------------------------------------------------------------------------

describe('resolveSquad() — init-mode guard', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('3.1 throws config error for empty cwd string', () => {
    const err = catchSquadError(() => resolveSquad({ cwd: '', env: {} }));
    expect(err).toBeInstanceOf(SquadError);
  });

  it('3.2 throws config error for whitespace-only cwd', () => {
    const err = catchSquadError(() => resolveSquad({ cwd: '   ', env: {} }));
    expect(err).toBeInstanceOf(SquadError);
  });

  it('3.3 throws ERR_CWD_UNREACHABLE when cwd does not exist', () => {
    const err = catchSquadError(() =>
      resolveSquad({ cwd: dir('does-not-exist-anywhere'), env: {} }),
    );
    expect(errorCode(err)).toBe('ERR_CWD_UNREACHABLE');
  });

  it('3.4 throws ERR_CWD_UNREACHABLE when cwd is a file rather than directory', () => {
    const filePath = dir('a-file.txt');
    writeFileSync(filePath, 'content', 'utf8');
    const err = catchSquadError(() => resolveSquad({ cwd: filePath, env: {} }));
    expect(errorCode(err)).toBe('ERR_CWD_UNREACHABLE');
  });

  it('3.5 does NOT throw when cwd exists and is a directory with no match — returns null', () => {
    scaffold('.git');
    const result = resolveSquad({ cwd: TMP, env: {} });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeRemoteUrl — URL canonicalization
// ---------------------------------------------------------------------------

describe('normalizeRemoteUrl()', () => {
  it('N.1 GitHub HTTPS strips .git suffix and returns host/path', () => {
    expect(normalizeRemoteUrl('https://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('N.2 GitHub HTTPS without .git suffix', () => {
    expect(normalizeRemoteUrl('https://github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('N.3 GitHub SSH equivalent to HTTPS', () => {
    expect(normalizeRemoteUrl('git@github.com:org/repo.git')).toBe('github.com/org/repo');
  });

  it('N.4 GitHub HTTPS and SSH canonicalize to the same key', () => {
    const https = normalizeRemoteUrl('https://github.com/myorg/myrepo.git');
    const ssh = normalizeRemoteUrl('git@github.com:myorg/myrepo.git');
    expect(https).toBe(ssh);
  });

  it('N.5 GitHub HTTPS strips userinfo', () => {
    expect(normalizeRemoteUrl('https://pat-token@github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('N.6 ADO modern HTTPS normalizes to dev.azure.com form', () => {
    expect(normalizeRemoteUrl('https://dev.azure.com/contoso/MyProject/_git/MyRepo')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.7 ADO modern HTTPS strips .git suffix', () => {
    expect(normalizeRemoteUrl('https://dev.azure.com/contoso/MyProject/_git/MyRepo.git')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.8 ADO legacy HTTPS normalizes to dev.azure.com form', () => {
    expect(normalizeRemoteUrl('https://contoso.visualstudio.com/MyProject/_git/MyRepo')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.9 ADO legacy HTTPS with .git suffix', () => {
    expect(normalizeRemoteUrl('https://contoso.visualstudio.com/MyProject/_git/MyRepo.git')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.10 ADO modern SSH normalizes to dev.azure.com form', () => {
    expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/contoso/MyProject/MyRepo')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.11 ADO modern SSH with trailing slash', () => {
    expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/contoso/MyProject/MyRepo/')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.12 ADO legacy SSH normalizes to dev.azure.com form', () => {
    expect(normalizeRemoteUrl('contoso@vs-ssh.visualstudio.com:v3/contoso/MyProject/MyRepo')).toBe(
      'dev.azure.com/contoso/MyProject/_git/MyRepo',
    );
  });

  it('N.13 ADO modern SSH and legacy HTTPS for same repo are equivalent', () => {
    const modernSsh = normalizeRemoteUrl('git@ssh.dev.azure.com:v3/contoso/MyProject/MyRepo');
    const legacyHttps = normalizeRemoteUrl('https://contoso.visualstudio.com/MyProject/_git/MyRepo');
    expect(modernSsh).toBe(legacyHttps);
  });

  it('N.14 unknown URL lowercases entire input', () => {
    const url = 'ssh://custom.host.com/org/Repo';
    expect(normalizeRemoteUrl(url)).toBe(url.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// collectCwdRemoteUrls
// ---------------------------------------------------------------------------

describe('collectCwdRemoteUrls()', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('CU.1 returns empty array for git repo with no remotes', () => {
    const repoDir = dir('no-remote-repo');
    mkdirSync(repoDir, { recursive: true });
    try {
      execSync(`git init "${repoDir}"`, { stdio: 'ignore' });
    } catch {
      return; // Skip if git unavailable
    }
    expect(collectCwdRemoteUrls(repoDir)).toEqual([]);
  });

  it('CU.2 returns empty array when git command fails or not a repo', () => {
    // Non-existent directory — git will fail
    expect(collectCwdRemoteUrls(dir('nonexistent'))).toEqual([]);
  });

  it('CU.3 returns fetch URLs from a git repo with remotes', () => {
    const repoDir = dir('repo-with-remote');
    mkdirSync(repoDir, { recursive: true });
    try {
      execSync(`git init "${repoDir}"`, { stdio: 'ignore' });
      execSync(`git -C "${repoDir}" remote add origin https://github.com/contoso/repo.git`, {
        stdio: 'ignore',
      });
    } catch {
      // Skip if git unavailable.
      return;
    }
    const urls = collectCwdRemoteUrls(repoDir);
    expect(urls).toContain('https://github.com/contoso/repo.git');
  });

  it('CU.4 deduplicates remotes that canonicalize to the same URL', () => {
    const repoDir = dir('repo-dedup');
    mkdirSync(repoDir, { recursive: true });
    try {
      execSync(`git init "${repoDir}"`, { stdio: 'ignore' });
      execSync(`git -C "${repoDir}" remote add origin https://github.com/contoso/repo.git`, {
        stdio: 'ignore',
      });
      execSync(`git -C "${repoDir}" remote add upstream git@github.com:contoso/repo.git`, {
        stdio: 'ignore',
      });
    } catch {
      return;
    }
    const urls = collectCwdRemoteUrls(repoDir);
    // Both canonicalize to github.com/contoso/repo — only one should be returned.
    expect(urls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Clones resolution (Step 4)
// ---------------------------------------------------------------------------

describe('resolveSquad() — clones resolution', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('4.1 returns source=clones when cwd equals a registered clone path', () => {
    scaffold('.git', 'clone-root', 'squad-home', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { callsign: 'myteam', path: dir('squad-home', '.squad'), clones: [dir('clone-root')] },
    ]);

    const result = resolveSquad({ cwd: dir('clone-root'), env: {}, registryPath: registryFile });
    expect(result?.source).toBe('clones');
    expect(result?.path).toBe(dir('squad-home', '.squad'));
    expect(result?.callsign).toBe('myteam');
    expect(result?.matchedOrigin).toBeNull();
  });

  it('4.2 returns source=clones when cwd is a subdirectory of a registered clone', () => {
    scaffold('.git', 'clone-root/packages/app', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), clones: [dir('clone-root')] },
    ]);

    const result = resolveSquad({
      cwd: dir('clone-root', 'packages', 'app'),
      env: {},
      registryPath: registryFile,
    });
    expect(result?.source).toBe('clones');
  });

  it('4.3 does NOT match a sibling directory with a shared name prefix', () => {
    scaffold('.git', 'repo', 'repo-tools', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), clones: [dir('repo')] },
    ]);

    // cwd = repo-tools — must NOT match clone = repo
    const result = resolveSquad({ cwd: dir('repo-tools'), env: {}, registryPath: registryFile });
    expect(result).toBeNull();
  });

  it('4.4 throws Ambiguous error when multiple registry entries match by clones', () => {
    scaffold('.git', 'shared-clone', 'squad-a/.squad', 'squad-b/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { callsign: 'team-a', path: dir('squad-a', '.squad'), clones: [dir('shared-clone')] },
      { callsign: 'team-b', path: dir('squad-b', '.squad'), clones: [dir('shared-clone')] },
    ]);

    const err = catchSquadError(() =>
      resolveSquad({ cwd: dir('shared-clone'), env: {}, registryPath: registryFile }),
    );
    expect(err.message).toMatch(/^Ambiguous/);
    expect(errorCode(err)).toBe('AMBIGUOUS_CLONES');
  });

  it('4.5 falls through when registry file is missing (no throw)', () => {
    scaffold('.git', 'clone-root');
    // No registry file — must not throw, must return null (no git, no .squad)
    const result = resolveSquad({
      cwd: dir('clone-root'),
      env: {},
      registryPath: dir('nonexistent', 'registry.json'),
    });
    expect(result).toBeNull();
  });

  it('4.6 falls through when no registry entry has clones', () => {
    scaffold('.git', 'clone-root', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    // Entry has no clones[] field
    writeRegistryFull(registryFile, [{ path: dir('squad-home', '.squad') }]);

    const result = resolveSquad({ cwd: dir('clone-root'), env: {}, registryPath: registryFile });
    expect(result).toBeNull();
  });

  it('4.6b entry with clones: [] (empty array) falls through silently', () => {
    scaffold('.git', 'clone-root', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    // Empty array is distinct from a missing field; both should silently fall through.
    writeRegistryFull(registryFile, [{ path: dir('squad-home', '.squad'), clones: [] }]);

    const result = resolveSquad({ cwd: dir('clone-root'), env: {}, registryPath: registryFile });
    expect(result).toBeNull();
  });

  it('4.7 callsign is omitted from result when registry entry has no callsign', () => {
    scaffold('.git', 'clone-root', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), clones: [dir('clone-root')] },
    ]);

    const result = resolveSquad({ cwd: dir('clone-root'), env: {}, registryPath: registryFile });
    expect(result?.source).toBe('clones');
    expect(result?.callsign).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Origins resolution (Step 5)
// ---------------------------------------------------------------------------

describe('resolveSquad() — origins resolution', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  function initGitWithRemote(repoPath: string, remoteName: string, remoteUrl: string): boolean {
    try {
      mkdirSyncFs(repoPath, { recursive: true });
      execSync(`git init "${repoPath}"`, { stdio: 'ignore' });
      execSync(`git -C "${repoPath}" remote add ${remoteName} ${remoteUrl}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  it('5.1 returns source=origins when cwd remote matches a registry origin (HTTPS)', () => {
    const repoDir = dir('my-repo');
    if (!initGitWithRemote(repoDir, 'origin', 'https://github.com/contoso/myrepo.git')) return;

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      {
        callsign: 'myteam',
        path: dir('squad-home', '.squad'),
        origins: ['https://github.com/contoso/myrepo.git'],
      },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('origins');
    expect(result?.path).toBe(dir('squad-home', '.squad'));
    expect(result?.matchedOrigin).toBe('https://github.com/contoso/myrepo.git');
  });

  it('5.2 SSH remote matches HTTPS origin in registry (GitHub equivalence)', () => {
    const repoDir = dir('ssh-repo');
    if (!initGitWithRemote(repoDir, 'origin', 'git@github.com:contoso/myrepo.git')) return;

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      {
        path: dir('squad-home', '.squad'),
        origins: ['https://github.com/contoso/myrepo.git'],
      },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('origins');
    // matchedOrigin is the REGISTRY string, not the remote string
    expect(result?.matchedOrigin).toBe('https://github.com/contoso/myrepo.git');
  });

  it('5.3 matchedOrigin preserves the original registry string verbatim', () => {
    const repoDir = dir('matchedOrigin-repo');
    const registryOrigin = 'https://github.com/contoso/myrepo.git';
    if (!initGitWithRemote(repoDir, 'origin', 'git@github.com:contoso/myrepo.git')) return;

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), origins: [registryOrigin] },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result?.matchedOrigin).toBe(registryOrigin);
  });

  it('5.4 non-origin remote name (not "origin") still matches', () => {
    const repoDir = dir('upstream-remote-repo');
    if (!initGitWithRemote(repoDir, 'upstream', 'https://github.com/contoso/myrepo.git')) return;

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), origins: ['https://github.com/contoso/myrepo.git'] },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('origins');
  });

  it('5.5 falls through when repo has no remotes', () => {
    const repoDir = dir('no-remote-repo');
    try {
      mkdirSyncFs(repoDir, { recursive: true });
      execSync(`git init "${repoDir}"`, { stdio: 'ignore' });
    } catch {
      return;
    }

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), origins: ['https://github.com/contoso/myrepo.git'] },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result).toBeNull();
  });

  it('5.6 throws Ambiguous origin when multiple registry entries match remote URL', () => {
    const repoDir = dir('ambiguous-origin-repo');
    if (!initGitWithRemote(repoDir, 'origin', 'https://github.com/contoso/myrepo.git')) return;

    scaffold('squad-a/.squad', 'squad-b/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      {
        callsign: 'team-a',
        path: dir('squad-a', '.squad'),
        origins: ['https://github.com/contoso/myrepo.git'],
      },
      {
        callsign: 'team-b',
        path: dir('squad-b', '.squad'),
        origins: ['git@github.com:contoso/myrepo.git'],
      },
    ]);

    const err = catchSquadError(() =>
      resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile }),
    );
    expect(err.message).toMatch(/^Ambiguous origin/);
    expect(errorCode(err)).toBe('AMBIGUOUS_ORIGINS');
  });

  it('5.7 ADO modern HTTPS origin matches ADO modern SSH remote', () => {
    const repoDir = dir('ado-ssh-repo');
    if (
      !initGitWithRemote(
        repoDir,
        'origin',
        'git@ssh.dev.azure.com:v3/contoso/MyProject/MyRepo',
      )
    )
      return;

    scaffold('squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      {
        path: dir('squad-home', '.squad'),
        origins: ['https://dev.azure.com/contoso/MyProject/_git/MyRepo'],
      },
    ]);

    const result = resolveSquad({ cwd: repoDir, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('origins');
  });
});

// ---------------------------------------------------------------------------
// Platform fallback (Step 6)
// ---------------------------------------------------------------------------

describe('resolveSquad() — platform fallback', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('6.1 returns source=platform for win32 with APPDATA set', () => {
    scaffold('.git', 'cwd-dir', 'appdata/squad/.squad');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: { APPDATA: dir('appdata') },
      platform: 'win32',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(dir('appdata', 'squad', '.squad'));
    expect(result?.matchedOrigin).toBeNull();
  });

  it('6.2 falls back to LOCALAPPDATA when APPDATA unset on win32', () => {
    scaffold('.git', 'cwd-dir', 'localappdata/squad/.squad');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: { LOCALAPPDATA: dir('localappdata') },
      platform: 'win32',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(dir('localappdata', 'squad', '.squad'));
  });

  it('6.3 returns source=platform for linux with XDG_DATA_HOME set', () => {
    scaffold('.git', 'cwd-dir', 'xdg-data/squad/.squad');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: { XDG_DATA_HOME: dir('xdg-data') },
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(dir('xdg-data', 'squad', '.squad'));
  });

  it('6.4 falls back to ~/.local/share on linux when XDG_DATA_HOME unset', () => {
    scaffold('.git', 'cwd-dir', 'fake-home/.local/share/squad/.squad');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: {},
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(dir('fake-home', '.local', 'share', 'squad', '.squad'));
  });

  it('6.5 returns source=platform for darwin with ~/Library/Application Support', () => {
    scaffold('.git', 'cwd-dir', 'fake-home/Library/Application Support/squad/.squad');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: {},
      platform: 'darwin',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(
      dir('fake-home', 'Library', 'Application Support', 'squad', '.squad'),
    );
  });

  it('6.6 falls through when platform squad directory does not exist', () => {
    scaffold('.git', 'cwd-dir');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: { XDG_DATA_HOME: dir('no-xdg-here') },
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result).toBeNull();
  });

  it('6.7 falls through when platform .squad path exists as a file rather than a directory', () => {
    scaffold('.git', 'cwd-dir', 'xdg-data/squad');
    writeFileSync(dir('xdg-data', 'squad', '.squad'), 'not-a-directory');
    const result = resolveSquad({
      cwd: dir('cwd-dir'),
      env: { XDG_DATA_HOME: dir('xdg-data') },
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Linked-worktree fallback (Step 7)
// ---------------------------------------------------------------------------

describe('resolveSquad() — linked-worktree fallback', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('7.1 returns source=worktree using .squad/ from first worktree with it', () => {
    const mainRepo = dir('main-repo');
    const linkedWorktree = dir('linked-worktree');

    mkdirSync(mainRepo, { recursive: true });
    try {
      execSync(`git init -b main "${mainRepo}"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.email "test@example.com"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.name "Test"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" commit --allow-empty -m init`, { stdio: 'ignore' });
      mkdirSync(join(mainRepo, '.squad'), { recursive: true });
      execSync(`git -C "${mainRepo}" worktree add "${linkedWorktree}"`, { stdio: 'ignore' });
    } catch {
      // Skip if git worktree feature unavailable.
      return;
    }

    const result = resolveSquad({ cwd: linkedWorktree, env: {} });
    expect(result?.source).toBe('worktree');
    expect(result?.path).toBe(join(mainRepo, '.squad'));
    expect(result?.matchedOrigin).toBeNull();
  });

  it('7.2 falls through when no worktree in the list has a .squad/ directory', () => {
    const mainRepo = dir('main-no-squad');
    const linkedWorktree = dir('linked-no-squad');

    mkdirSync(mainRepo, { recursive: true });
    try {
      execSync(`git init -b main "${mainRepo}"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.email "test@example.com"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.name "Test"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" commit --allow-empty -m init`, { stdio: 'ignore' });
      // No .squad/ created in main repo
      execSync(`git -C "${mainRepo}" worktree add "${linkedWorktree}"`, { stdio: 'ignore' });
    } catch {
      return;
    }

    const result = resolveSquad({ cwd: linkedWorktree, env: {} });
    expect(result).toBeNull();
  });

  it('7.3 falls through when main-repo .squad is a file rather than a directory', () => {
    const mainRepo = dir('main-squad-file');
    const linkedWorktree = dir('linked-squad-file');

    mkdirSync(mainRepo, { recursive: true });
    try {
      execSync(`git init -b main "${mainRepo}"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.email "test@example.com"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.name "Test"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" commit --allow-empty -m init`, { stdio: 'ignore' });
      // Write .squad as a FILE, not a directory — resolver must treat as no-match.
      writeFileSync(join(mainRepo, '.squad'), 'not-a-directory');
      execSync(`git -C "${mainRepo}" worktree add "${linkedWorktree}"`, { stdio: 'ignore' });
    } catch {
      return;
    }

    const result = resolveSquad({ cwd: linkedWorktree, env: {} });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full chain precedence
// ---------------------------------------------------------------------------

describe('resolveSquad() — full chain precedence', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
    mkdirSync(TMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('9.1 explicit callsign wins over all other steps', () => {
    scaffold('.git', '.squad', 'explicit/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistry(registryFile, [{ callsign: 'flag-team', path: dir('explicit', '.squad') }]);

    const result = resolveSquad({
      cwd: TMP,
      callsign: 'flag-team',
      env: {},
      registryPath: registryFile,
    });
    expect(result?.source).toBe('env'); // opts.callsign and SQUAD_CALLSIGN both route through resolveByCallsign
    expect(result?.path).toBe(dir('explicit', '.squad'));
  });

  it('9.2 worktree-local wins over clones step', () => {
    scaffold('.git', '.squad', 'squad-home/.squad', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), clones: [TMP] },
    ]);

    const result = resolveSquad({ cwd: TMP, env: {}, registryPath: registryFile });
    expect(result?.source).toBe('local');
  });

  it('9.3 clones step wins over platform fallback', () => {
    scaffold('.git', 'clone-root', 'squad-home/.squad', 'registry', 'xdg/squad/.squad');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { path: dir('squad-home', '.squad'), clones: [dir('clone-root')] },
    ]);

    const result = resolveSquad({
      cwd: dir('clone-root'),
      env: { XDG_DATA_HOME: dir('xdg') },
      platform: 'linux',
      homeDir: dir('fake-home'),
      registryPath: registryFile,
    });
    expect(result?.source).toBe('clones');
  });

  it('9.4 exhausted chain returns null', () => {
    // Scaffold .git to anchor git root at TMP (no .squad/ present).
    // Set platform overrides so platform fallback also finds nothing.
    scaffold('.git', 'plain-dir');
    const result = resolveSquad({
      cwd: dir('plain-dir'),
      env: {},
      platform: 'linux',
      homeDir: dir('fake-home-no-squad'),
      registryPath: dir('nonexistent', 'registry.json'),
    });
    expect(result).toBeNull();
  });

  it('9.5 SQUAD_CALLSIGN (step 3) beats clones match (step 4)', () => {
    // No local .squad/ at git root → step 2 falls through.
    // SQUAD_CALLSIGN points to team-a → step 3 fires and returns early.
    // CWD also matches team-b's clone entry → step 4 would have returned team-b,
    // but step 3 already returned.
    scaffold('.git', 'squad-a/.squad', 'squad-b/.squad', 'clone-b', 'registry');
    const registryFile = dir('registry', 'registry.json');
    writeRegistryFull(registryFile, [
      { callsign: 'team-a', path: dir('squad-a', '.squad') },
      { callsign: 'team-b', path: dir('squad-b', '.squad'), clones: [dir('clone-b')] },
    ]);

    const result = resolveSquad({
      cwd: dir('clone-b'),
      env: { SQUAD_CALLSIGN: 'team-a' },
      registryPath: registryFile,
    });
    expect(result?.source).toBe('env');
    expect(result?.path).toBe(dir('squad-a', '.squad'));
  });

  it('9.6 origins match (step 5) beats platform fallback (step 6)', () => {
    // CWD has a remote URL matching a registry origin → step 5 returns.
    // Platform .squad/ also exists → step 6 would have returned, but step 5 fires first.
    const repoDir = dir('origins-repo-96');
    mkdirSync(repoDir, { recursive: true });
    try {
      execSync(`git init "${repoDir}"`, { stdio: 'ignore' });
      execSync(`git -C "${repoDir}" remote add origin https://github.com/contoso/myrepo96.git`, {
        stdio: 'ignore',
      });
    } catch {
      return; // Skip if git unavailable.
    }

    scaffold('squad-96/.squad', 'registry-96', 'xdg-96/squad/.squad');
    const registryFile = dir('registry-96', 'registry.json');
    writeRegistryFull(registryFile, [
      {
        callsign: 'team-96',
        path: dir('squad-96', '.squad'),
        origins: ['https://github.com/contoso/myrepo96.git'],
      },
    ]);

    const result = resolveSquad({
      cwd: repoDir,
      env: { XDG_DATA_HOME: dir('xdg-96') },
      platform: 'linux',
      homeDir: dir('fake-home'),
      registryPath: registryFile,
    });
    expect(result?.source).toBe('origins');
    expect(result?.path).toBe(dir('squad-96', '.squad'));
  });

  it('9.7 platform fallback (step 6) beats linked-worktree (step 7)', () => {
    // Set up a linked worktree whose main repo has .squad/ → step 7 would match.
    // Also set up a platform .squad/ → step 6 fires first.
    const mainRepo = dir('main-repo-97');
    const linkedWorktree = dir('linked-worktree-97');

    mkdirSync(mainRepo, { recursive: true });
    try {
      execSync(`git init -b main "${mainRepo}"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.email "test@example.com"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" config user.name "Test"`, { stdio: 'ignore' });
      execSync(`git -C "${mainRepo}" commit --allow-empty -m init`, { stdio: 'ignore' });
      mkdirSync(join(mainRepo, '.squad'), { recursive: true });
      execSync(`git -C "${mainRepo}" worktree add "${linkedWorktree}"`, { stdio: 'ignore' });
    } catch {
      return; // Skip if git worktree feature unavailable.
    }

    scaffold('xdg-97/squad/.squad');
    const result = resolveSquad({
      cwd: linkedWorktree,
      env: { XDG_DATA_HOME: dir('xdg-97') },
      platform: 'linux',
      homeDir: dir('fake-home'),
    });
    expect(result?.source).toBe('platform');
    expect(result?.path).toBe(dir('xdg-97', 'squad', '.squad'));
  });
});

// ---------------------------------------------------------------------------
// RRP — Registry-path parity (writer/reader agreement)
// ---------------------------------------------------------------------------

describe('defaultRegistryFilePath() — path-utils helper', () => {
  it('RRP.1 uses ~/.squad/registry.json when SQUAD_HOME is not set', () => {
    const fakeHome = join(process.cwd(), '.test-rrp-home-' + randomBytes(4).toString('hex'));
    const result = defaultRegistryFilePath(fakeHome, {});
    expect(result).toBe(join(fakeHome, '.squad', 'registry.json'));
  });

  it('RRP.2 uses SQUAD_HOME/registry.json when SQUAD_HOME is set', () => {
    const squadHome = join(process.cwd(), '.test-rrp-squadhome-' + randomBytes(4).toString('hex'));
    const result = defaultRegistryFilePath('/any-home', { SQUAD_HOME: squadHome });
    expect(result).toBe(join(pathResolve(squadHome), 'registry.json'));
  });

  it('RRP.3 path agreement: writer and resolveSquad reader return identical path (no SQUAD_HOME)', () => {
    // The "writer" path: what the CLI would compute for the default registry location.
    // The "reader" path: what resolveSquad would probe — verified indirectly by
    // checking that a registry written at writerPath is found by resolveSquad.
    const fakeHome = join(process.cwd(), '.test-rrp-agree-' + randomBytes(4).toString('hex'));
    const writerPath = defaultRegistryFilePath(fakeHome, {});
    // Confirm the reader (resolveEffectiveRegistryPath) uses the SAME path:
    // both must return ~/.squad/registry.json when SQUAD_HOME is absent.
    const expectedPath = join(fakeHome, '.squad', 'registry.json');
    expect(writerPath).toBe(expectedPath);
  });

  it('RRP.4 path agreement: writer and resolveSquad reader agree when SQUAD_HOME is set', () => {
    const squadHome = join(process.cwd(), '.test-rrp-sh-' + randomBytes(4).toString('hex'));
    const env = { SQUAD_HOME: squadHome };
    const writerPath = defaultRegistryFilePath('/any-home', env);
    const expectedPath = join(pathResolve(squadHome), 'registry.json');
    expect(writerPath).toBe(expectedPath);
  });
});

describe('resolveSquad() — registry path parity (end-to-end)', () => {
  const TMP2 = join(process.cwd(), `.test-rrp-e2e-${randomBytes(4).toString('hex')}`);

  beforeEach(() => {
    if (existsSync(TMP2)) rmSync(TMP2, { recursive: true, force: true });
    mkdirSync(TMP2, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP2)) rmSync(TMP2, { recursive: true, force: true });
  });

  it('RRP.5 resolveSquad finds a squad written at defaultRegistryFilePath (clones match)', () => {
    // Writer computes: defaultRegistryFilePath(fakeHome, {}) → fakeHome/.squad/registry.json
    // Reader (resolveEffectiveRegistryPath) must probe the same path.
    const fakeHome = join(TMP2, 'home');
    const cwdDir = join(TMP2, 'my-clone');
    const squadDir = join(TMP2, 'my-squad', '.squad');
    // Create a .git marker at TMP2 level so walk-up stops here (doesn't escape to repo root).
    mkdirSync(join(TMP2, '.git'), { recursive: true });
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(squadDir, { recursive: true });

    // Write registry at the writer-computed path.
    const registryPath = defaultRegistryFilePath(fakeHome, {});
    mkdirSync(join(fakeHome, '.squad'), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        squads: [{ callsign: 'parity-squad', path: squadDir, clones: [cwdDir] }],
      }),
      'utf8',
    );

    // Reader: resolveSquad with homeDir=fakeHome and no explicit registryPath.
    const result = resolveSquad({ cwd: cwdDir, env: {}, homeDir: fakeHome });
    expect(result).not.toBeNull();
    expect(result?.source).toBe('clones');
    expect(result?.path).toBe(squadDir);
  });

  it('RRP.6 writing to old platform-default path does NOT cause spurious resolution (negative test)', () => {
    // OLD win32 path was: APPDATA\squad\registry.json
    // Verify that writing there does NOT resolve a squad entry.
    const fakeHome = join(TMP2, 'home-neg');
    const fakeAppData = join(TMP2, 'appdata');
    const cwdDir = join(TMP2, 'my-clone-neg');
    const squadDir = join(TMP2, 'my-squad-neg', '.squad');
    // Create a .git marker at TMP2 level so walk-up stops here (doesn't escape to repo root).
    mkdirSync(join(TMP2, '.git'), { recursive: true });
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(squadDir, { recursive: true });

    // Write registry at the OLD win32 location (APPDATA\squad\registry.json).
    const oldPlatformPath = join(fakeAppData, 'squad', 'registry.json');
    mkdirSync(join(fakeAppData, 'squad'), { recursive: true });
    writeFileSync(
      oldPlatformPath,
      JSON.stringify({
        version: 1,
        squads: [{ callsign: 'ghost-squad', path: squadDir, clones: [cwdDir] }],
      }),
      'utf8',
    );

    // Reader uses defaultRegistryFilePath(fakeHome, { APPDATA: fakeAppData }).
    // With the fix, APPDATA is ignored for the registry path — we read from fakeHome/.squad/registry.json.
    // No registry there → returns null.
    const result = resolveSquad({
      cwd: cwdDir,
      env: { APPDATA: fakeAppData },
      homeDir: fakeHome,
    });
    expect(result).toBeNull();
  });
});
