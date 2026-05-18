/**
 * Tests for the squad assign command module.
 *
 * @module commands/__tests__/assign.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { runAssign } from '../assign.js';
import type { SquadAssignOpts } from '../assign.js';

const TEST_ROOT = path.join(process.cwd(), `.test-assign-${randomBytes(4).toString('hex')}`);

function makeDir(relPath: string): string {
  const dir = path.join(TEST_ROOT, relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSquadHost(dir: string): string {
  const squadDir = path.join(dir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), '# Team\n');
  return squadDir;
}

function writeRegistry(registryPath: string, squads: unknown[]): void {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, squads }, null, 2));
}

function readRegistry(registryPath: string): { version: number; squads: unknown[] } {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

// ============================================================
// Warm path tests
// ============================================================

describe('runAssign: warm path success', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A1 appends git root to clones[] and normalized fetch remotes to origins[]', async () => {
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => ['https://github.com/example/api'],
    });

    expect(result.kind).toBe('assigned');
    expect(result.callsign).toBe('alpha');
    expect(result.clonePath).toBe(cloneDir);

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['clones']).toContain(cloneDir);
    expect(entry['origins']).toContain('github.com/example/api');
  });

  it('A2 idempotent: same callsign + same clone returns alreadyAssigned without duplicates', async () => {
    const opts: SquadAssignOpts = {
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => ['https://github.com/example/api'],
    };

    await runAssign(opts);
    const result = await runAssign(opts);

    expect(result.kind).toBe('alreadyAssigned');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    // No duplicates in clones or origins
    expect((entry['clones'] as string[]).filter(c => c === cloneDir)).toHaveLength(1);
    expect((entry['origins'] as string[]).filter(o => o === 'github.com/example/api')).toHaveLength(1);
  });
});

describe('runAssign: guard failures', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A3 unknown callsign → error with close-match suggestion when available', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'alph',   // close to 'alpha'
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_UNKNOWN_CALLSIGN/);

    await expect(
      runAssign({
        callsignOrUrl: 'alph',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/alpha/);  // suggestion
  });

  it('A4 missing callsign → missing argument error', async () => {
    await expect(
      runAssign({
        callsignOrUrl: '',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_MISSING_ARG/);
  });

  it('A7 missing host path → actionable error', async () => {
    // Overwrite registry with a stale path
    const stalePath = path.join(TEST_ROOT, 'nonexistent.squad');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: stalePath,
      origins: [],
      clones: [],
    }]);

    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_HOST_PATH_MISSING/);
  });

  it('A8 URL without --clone-to → cold-start guidance error', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'https://github.com/example/squad.git',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_URL_WITHOUT_CLONE_TO/);
  });
});

describe('runAssign: inactive entry reactivation', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      status: 'inactive',
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A5 inactive entry status flips to active on assign', async () => {
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.kind).toBe('reactivated');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
  });
});

describe('runAssign: cross-assignment collision', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    const hostDir2 = makeDir('host2');
    const squadPath2 = makeSquadHost(hostDir2);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [
      { callsign: 'alpha', path: squadPath, origins: [], clones: [cloneDir] },
      { callsign: 'beta', path: squadPath2, origins: [], clones: [] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A6 assigning to different callsign when already assigned → conflict with unassign hint', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'beta',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CROSS_CALLSIGN/);

    await expect(
      runAssign({
        callsignOrUrl: 'beta',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/unassign/i);
  });
});

describe('runAssign: containment guard', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [cloneDir],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A15 assigning from subdir of already-assigned clone → containment guard error', async () => {
    const subdir = path.join(cloneDir, 'src');
    fs.mkdirSync(subdir, { recursive: true });

    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: subdir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CONTAINMENT/);
  });
});

describe('runAssign: host-path guard', () => {
  let hostDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A16 assigning from the squad host directory → no-op success', async () => {
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: hostDir,   // running from the host itself
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    expect(result.kind).toBe('noOp');
    // Registry not mutated
    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect((entry['clones'] as string[]).length).toBe(0);
  });
});

describe('runAssign: origin collision', () => {
  let hostDir: string;
  let hostDir2: string;
  let hostDir3: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    hostDir2 = makeDir('host2');
    const squadPath2 = makeSquadHost(hostDir2);
    hostDir3 = makeDir('host3');
    const squadPath3 = makeSquadHost(hostDir3);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [
      { callsign: 'alpha', path: squadPath, origins: [], clones: [] },
      { callsign: 'beta', path: squadPath2, origins: ['github.com/example/shared'], clones: [] },
      { callsign: 'gamma', path: squadPath3, origins: ['github.com/example/shared'], clones: [] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A18 one-entry origin collision → warning, assign continues', async () => {
    // beta has 'github.com/example/shared'; alpha does not → assigning alpha with same remote → one warning
    // But wait, we need only ONE entry to match. Let me use a 2-entry registry.
    const hostDir2Local = makeDir('host2-local');
    const squadPath2Local = makeSquadHost(hostDir2Local);
    const localRegistryPath = path.join(TEST_ROOT, 'local-registry.json');
    writeRegistry(localRegistryPath, [
      { callsign: 'alpha', path: path.join(hostDir, '.squad'), origins: [], clones: [] },
      { callsign: 'beta', path: squadPath2Local, origins: ['github.com/example/shared'], clones: [] },
    ]);

    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath: localRegistryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => ['https://github.com/example/shared'],  // normalizes to github.com/example/shared
    });

    expect(result.kind).toBe('assigned');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/beta/);
  });

  it('A19 two-entry origin ambiguity → error', async () => {
    // beta and gamma both have 'github.com/example/shared' → error
    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => ['https://github.com/example/shared'],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_ORIGIN_AMBIGUITY/);
  });
});

describe('runAssign: case sensitivity', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'Alpha',
      path: squadPath,
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A20 callsign matching is case-sensitive on all platforms', async () => {
    // 'alpha' != 'Alpha'
    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_UNKNOWN_CALLSIGN/);

    // 'Alpha' matches exactly
    const result = await runAssign({
      callsignOrUrl: 'Alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });
    expect(result.kind).toBe('assigned');
  });
});

describe('runAssign: forward-compat registry fields', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [{
      callsign: 'alpha',
      path: squadPath,
      status: 'active',
      initUri: 'https://example.com/host.git',
      stateBackend: 'worktree',
      _futureField: 'must-survive',
      origins: [],
      clones: [],
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A21 status, initUri, stateBackend, and unknown fields survive assign unchanged', async () => {
    await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
    expect(entry['initUri']).toBe('https://example.com/host.git');
    expect(entry['stateBackend']).toBe('worktree');
    expect(entry['_futureField']).toBe('must-survive');
  });
});

// ============================================================
// Cross-entry clone collision
// ============================================================

describe('runAssign: cross-entry clone collision', () => {
  let hostDir: string;
  let hostDir2: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    hostDir2 = makeDir('host2');
    const squadPath2 = makeSquadHost(hostDir2);
    cloneDir = makeDir('clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, [
      { callsign: 'alpha', path: squadPath, origins: [], clones: [] },
      { callsign: 'beta', path: squadPath2, origins: [], clones: [cloneDir] },
    ]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A17 git root already in another entry\'s clones → cross-entry collision', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CROSS_CALLSIGN/);
  });
});

// ============================================================
// Cold-start tests
// ============================================================

describe('runAssign: cold-start', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;
  let cloneDest: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    cloneDir = makeDir('product-clone');
    cloneDest = path.join(TEST_ROOT, 'squad-host');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    // Start with empty registry
    writeRegistry(registryPath, []);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A9 non-empty --clone-to destination → error before clone, no clone attempted', async () => {
    // Create a non-empty cloneDest
    fs.mkdirSync(cloneDest, { recursive: true });
    fs.writeFileSync(path.join(cloneDest, 'existing-file.txt'), 'content');

    let cloneCalled = false;
    await expect(
      runAssign({
        callsignOrUrl: 'https://github.com/example/squad.git',
        cloneTo: cloneDest,
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        cloneCommand: async () => { cloneCalled = true; },
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CLONE_DEST_NOT_EMPTY/);

    expect(cloneCalled).toBe(false);
  });

  it('A10 pre-clone callsign collision → conflict before clone', async () => {
    // Registry has 'squad' callsign at a different path
    const existingHostDir = makeDir('existing-host');
    const existingSquadPath = makeSquadHost(existingHostDir);
    writeRegistry(registryPath, [{
      callsign: 'squad',
      path: existingSquadPath,
      origins: [],
      clones: [],
    }]);

    let cloneCalled = false;
    await expect(
      runAssign({
        callsignOrUrl: 'https://github.com/example/squad.git',  // derives 'squad'
        cloneTo: cloneDest,
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        cloneCommand: async () => { cloneCalled = true; },
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CALLSIGN_COLLISION/);

    expect(cloneCalled).toBe(false);
  });

  it('A11 clone failure → directory created during clone is removed', async () => {
    const cloneCommand = async (_url: string, dest: string) => {
      // Simulate git creating the directory before failing
      fs.mkdirSync(dest, { recursive: true });
      throw new Error('simulated git clone failure');
    };

    await expect(
      runAssign({
        callsignOrUrl: 'https://github.com/example/squad.git',
        cloneTo: cloneDest,
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        cloneCommand,
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CLONE_FAILED/);

    // Rollback: directory must be removed
    expect(fs.existsSync(cloneDest)).toBe(false);
  });

  it('A12 cloned repo missing .squad/team.md → clone rolled back, registry unchanged', async () => {
    const cloneCommand = async (_url: string, dest: string) => {
      // Clone succeeds but no .squad/team.md
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'README.md'), '# Repo\n');
    };

    await expect(
      runAssign({
        callsignOrUrl: 'https://github.com/example/squad.git',
        cloneTo: cloneDest,
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        cloneCommand,
      }),
    ).rejects.toThrow(/ERR_ASSIGN_NO_TEAM_MD/);

    // Rollback: clone dir removed
    expect(fs.existsSync(cloneDest)).toBe(false);
    // Registry unchanged (still empty)
    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(0);
  });

  it('A13 cold-start success: creates entry, records initUri, binds product clone', async () => {
    const url = 'https://github.com/example/squad.git';
    const cloneCommand = async (_url: string, dest: string) => {
      // Simulate successful clone with .squad/team.md
      fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
      fs.writeFileSync(path.join(dest, '.squad', 'team.md'), '# Team\n');
    };

    const result = await runAssign({
      callsignOrUrl: url,
      cloneTo: cloneDest,
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => ['https://github.com/example/product'],
      cloneCommand,
    });

    expect(result.kind).toBe('assigned');
    expect(result.callsign).toBe('squad');  // derived from URL
    expect(result.hostPath).toBe(path.join(cloneDest, '.squad'));
    expect(result.clonePath).toBe(cloneDir);

    const reg = readRegistry(registryPath);
    expect(reg.squads).toHaveLength(1);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['callsign']).toBe('squad');
    expect(entry['initUri']).toBe(url);
    expect(entry['path']).toBe(path.join(cloneDest, '.squad'));
    expect(entry['clones']).toContain(cloneDir);
  });

  it('A14 --callsign flag overrides URL-derived default callsign', async () => {
    const cloneCommand = async (_url: string, dest: string) => {
      fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
      fs.writeFileSync(path.join(dest, '.squad', 'team.md'), '# Team\n');
    };

    const result = await runAssign({
      callsignOrUrl: 'https://github.com/example/squad.git',
      cloneTo: cloneDest,
      callsign: 'custom-name',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
      cloneCommand,
    });

    expect(result.kind).toBe('assigned');
    expect(result.callsign).toBe('custom-name');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['callsign']).toBe('custom-name');
  });
});
