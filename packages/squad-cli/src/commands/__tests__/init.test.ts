/**
 * Tests for the squad init command module.
 *
 * @module commands/__tests__/init.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runInit } from '../init.js';
import type { RunInitResult } from '../init.js';

const TEST_ROOT = path.join(process.cwd(), `.test-init-${randomBytes(4).toString('hex')}`);

function makeDir(relPath: string): string {
  const dir = path.join(TEST_ROOT, relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

function readRegistry(registryPath: string): { version: number; squads: unknown[] } {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function scaffoldExists(targetDir: string): boolean {
  return (
    fs.existsSync(path.join(targetDir, '.squad')) &&
    fs.existsSync(path.join(targetDir, '.squad', 'team.md'))
  );
}

const itWindows = os.platform() === 'win32' ? it : it.skip;

// ============================================================
// --target-dir
// ============================================================

describe('runInit: --target-dir', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I1 creates .squad/ scaffold under the supplied target directory, not the cwd', async () => {
    const targetDir = makeDir('project');
    const registryPath = path.join(TEST_ROOT, 'registry.json');

    await runInit({ targetDir, registryPath, cwd: TEST_ROOT });

    expect(fs.existsSync(path.join(targetDir, '.squad'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.squad', 'team.md'))).toBe(true);
    // cwd itself must not have a .squad/ created
    expect(fs.existsSync(path.join(TEST_ROOT, '.squad'))).toBe(false);
  });

  it('I2 uses the target directory basename as callsign when no explicit name is supplied', async () => {
    const targetDir = makeDir('my-named-project');
    const registryPath = path.join(TEST_ROOT, 'registry.json');

    const result = await runInit({ targetDir, registryPath, cwd: TEST_ROOT });

    expect(result.registered?.callsign).toBe('my-named-project');
  });
});

// ============================================================
// --registry-path
// ============================================================

describe('runInit: --registry-path', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I3 reads existing entries from the custom registry file and writes the new entry to it', async () => {
    const targetDir = makeDir('newproject');
    const registryPath = path.join(TEST_ROOT, 'custom-registry.json');
    const existingSquadPath = path.join(TEST_ROOT, 'other', '.squad');
    writeRegistry(registryPath, [
      { callsign: 'existing', path: existingSquadPath, status: 'active', origins: [], clones: [] },
    ]);

    const result = await runInit({ targetDir, registryPath, callsign: 'newproject', cwd: TEST_ROOT });

    expect(result.registered?.callsign).toBe('newproject');
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(2);
    const callsigns = (reg.squads as Record<string, unknown>[]).map(s => s['callsign']);
    expect(callsigns).toContain('existing');
    expect(callsigns).toContain('newproject');
  });
});

// ============================================================
// --no-register
// ============================================================

describe('runInit: --no-register', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I4 creates local scaffold files without adding a registry entry', async () => {
    const targetDir = makeDir('scaffold-only');
    const registryPath = path.join(TEST_ROOT, 'registry.json');

    const result = await runInit({ targetDir, registryPath, callsign: 'scaffold-only', noRegister: true, cwd: TEST_ROOT });

    expect(scaffoldExists(targetDir)).toBe(true);
    expect(fs.existsSync(registryPath)).toBe(false);
    expect(result.registered).toBeUndefined();
    expect(result.reactivated).toBeUndefined();
  });

  it('I5 leaves an inactive registry entry unchanged when --no-register is set', async () => {
    const targetDir = makeDir('no-reactivate');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadDir = path.join(targetDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'no-reactivate',
      path: squadDir,
      status: 'inactive',
      origins: [],
      clones: [],
    }]);
    const registryBefore = fs.readFileSync(registryPath, 'utf8');

    await runInit({ targetDir, registryPath, callsign: 'no-reactivate', noRegister: true, cwd: TEST_ROOT });

    expect(fs.readFileSync(registryPath, 'utf8')).toBe(registryBefore);
  });
});

// ============================================================
// Reactivation
// ============================================================

describe('runInit: reactivation', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I6 flips an inactive entry with a matching callsign and path to active', async () => {
    const targetDir = makeDir('reactivate-me');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadDir = path.join(targetDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'reactivate-me',
      path: squadDir,
      status: 'inactive',
      origins: [],
      clones: [],
    }]);

    const result = await runInit({ targetDir, registryPath, callsign: 'reactivate-me', cwd: TEST_ROOT });

    expect(result.reactivated).toBeDefined();
    expect(result.reactivated?.callsign).toBe('reactivate-me');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
  });

  it('I7 preserves all non-status fields when reactivating an inactive entry', async () => {
    const targetDir = makeDir('preserve-meta');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadDir = path.join(targetDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'preserve-meta',
      path: squadDir,
      status: 'inactive',
      origins: ['github.com/example/repo'],
      clones: [],
      stateBackend: 'worktree',
      _customField: 'preserved-value',
    }]);

    await runInit({ targetDir, registryPath, callsign: 'preserve-meta', cwd: TEST_ROOT });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
    expect(entry['callsign']).toBe('preserve-meta');
    expect(entry['origins']).toEqual(['github.com/example/repo']);
    expect(entry['stateBackend']).toBe('worktree');
    expect(entry['_customField']).toBe('preserved-value');
  });

  it('I6b reactivates across trailing-slash variant', async () => {
    const targetDir = makeDir('reactivate-trailing');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadDir = path.join(targetDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'reactivate-trailing',
      path: squadDir,
      status: 'inactive',
      origins: [],
      clones: [],
    }]);

    const result = await runInit({
      targetDir: `${targetDir}${path.sep}`,
      registryPath,
      callsign: 'reactivate-trailing',
      cwd: TEST_ROOT,
    });

    expect(result.reactivated?.callsign).toBe('reactivate-trailing');
    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
  });

  itWindows('I6c reactivates across case-only variant on Windows', async () => {
    const targetDir = makeDir('ReactivateCase');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    const squadDir = path.join(targetDir, '.squad');
    writeRegistry(registryPath, [{
      callsign: 'reactivate-case',
      path: path.join(path.dirname(squadDir).toUpperCase(), '.squad'),
      status: 'inactive',
      origins: [],
      clones: [],
    }]);

    const result = await runInit({
      targetDir: targetDir.toLowerCase(),
      registryPath,
      callsign: 'reactivate-case',
      cwd: TEST_ROOT,
    });

    expect(result.reactivated?.callsign).toBe('reactivate-case');
    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
  });

  // Known gap: a relative registry path is resolved from the process working directory,
  // so a cwd-relative target directory does not reactivate the matching inactive entry.
  it.fails('I6d reactivates when registry entry is resolved-absolute vs target-dir is relative', async () => {
    const relativeTargetDir = 'reactivate-relative';
    makeDir(relativeTargetDir);
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'reactivate-relative',
      path: path.join('.', relativeTargetDir, '.squad'),
      status: 'inactive',
      origins: [],
      clones: [],
    }]);

    const result = await runInit({
      targetDir: relativeTargetDir,
      registryPath,
      callsign: 'reactivate-relative',
      cwd: TEST_ROOT,
    });

    expect(result.reactivated?.callsign).toBe('reactivate-relative');
    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
  });
});

// ============================================================
// Collision
// ============================================================

describe('runInit: active callsign collision', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I8 throws ERR_SQUAD_INIT_CALLSIGN_EXISTS for an active callsign registered at a different path', async () => {
    const targetDir = makeDir('new-dir');
    const otherSquadPath = path.join(TEST_ROOT, 'other', '.squad');
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'taken',
      path: otherSquadPath,
      status: 'active',
      origins: [],
      clones: [],
    }]);

    await expect(
      runInit({ targetDir, registryPath, callsign: 'taken', cwd: TEST_ROOT }),
    ).rejects.toMatchObject({ message: expect.stringContaining('ERR_SQUAD_INIT_CALLSIGN_EXISTS') });
  });
});

// ============================================================
// Existing scaffold registration
// ============================================================

describe('runInit: existing scaffold registration', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('I9 registers a callsign for an existing .squad/ directory without clobbering sentinel files', async () => {
    const targetDir = makeDir('existing-scaffold');
    const squadDir = path.join(targetDir, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    fs.writeFileSync(path.join(squadDir, 'team.md'), '# Existing Team\n');
    const registryPath = path.join(TEST_ROOT, 'registry.json');

    const result = await runInit({ targetDir, registryPath, callsign: 'existing-scaffold', cwd: TEST_ROOT });

    expect(result.registered?.callsign).toBe('existing-scaffold');
    // Sentinel file must not be overwritten
    expect(fs.readFileSync(path.join(squadDir, 'team.md'), 'utf8')).toBe('# Existing Team\n');
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
  });

  it('I10 re-running the same registration does not duplicate registry entries', async () => {
    const targetDir = makeDir('idempotent');
    const registryPath = path.join(TEST_ROOT, 'registry.json');

    const result1 = await runInit({ targetDir, registryPath, callsign: 'idempotent', cwd: TEST_ROOT }) as RunInitResult;
    expect(result1.registered?.callsign).toBe('idempotent');

    const registryBefore = fs.readFileSync(registryPath, 'utf8');
    const parsedBefore = JSON.parse(registryBefore) as { version: number; squads: unknown[] };

    const result2 = await runInit({ targetDir, registryPath, callsign: 'idempotent', cwd: TEST_ROOT }) as RunInitResult;
    expect(result2.reactivated?.callsign).toBe('idempotent');

    const registryAfter = fs.readFileSync(registryPath, 'utf8');
    const parsedAfter = JSON.parse(registryAfter) as { version: number; squads: unknown[] };
    expect(parsedAfter).toEqual(parsedBefore);
    expect(registryAfter).toBe(registryBefore);

    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
  });

  // Known gap: concurrent load-modify-write cycles against one registry file can
  // overwrite a peer write even though each individual file replace is atomic.
  it.fails('I11 concurrent runInit calls do not lose entries', async () => {
    const registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, []);

    await Promise.all([
      runInit({
        targetDir: makeDir('alpha-project'),
        registryPath,
        callsign: 'alpha-project',
        cwd: TEST_ROOT,
      }),
      runInit({
        targetDir: makeDir('beta-project'),
        registryPath,
        callsign: 'beta-project',
        cwd: TEST_ROOT,
      }),
    ]);

    const reg = readRegistry(registryPath);
    const callsigns = (reg.squads as Record<string, unknown>[])
      .map(entry => entry['callsign'])
      .sort();
    expect(callsigns).toEqual(['alpha-project', 'beta-project']);
  });
});
