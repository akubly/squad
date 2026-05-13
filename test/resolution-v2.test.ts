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
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

import { resolveSquad, normalizeRemoteUrl, collectCwdRemoteUrls } from '@bradygaster/squad-sdk/resolution-v2';
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
    expect(result?.source).toBe('env');
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
});

