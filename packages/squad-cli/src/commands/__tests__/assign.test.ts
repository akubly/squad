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
import type { SquadAssignOpts, AssignKind, SquadAssignResult } from '../assign.js';

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
    // TypeScript cannot narrow based on expect(), so cast to access warnings on the assigned variant.
    const warnings = (result as { warnings: string[] }).warnings;
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/beta/);
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

describe('runAssign: callsign validation', () => {
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

  it('A20 non-canonical uppercase callsigns do not match the canonical lowercase registry entry', async () => {
    await expect(
      runAssign({
        callsignOrUrl: 'Alpha',
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_UNKNOWN_CALLSIGN/);

    const result = await runAssign({
      callsignOrUrl: 'alpha',
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
      stateBackend: 'orphan',
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
    expect(entry['stateBackend']).toBe('orphan');
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

// ============================================================
// A15b — Guard ordering: containment fires before git-root collapse (F1)
// ============================================================

describe('runAssign: guard ordering (containment before idempotency)', () => {
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
      clones: [cloneDir],  // cloneDir is already assigned
    }]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A15b containment guard fires before git-root collapse (guard ordering)', async () => {
    // Scenario: user runs from a subdirectory of an already-assigned clone.
    // Real git: getGitRoot('/clone/src') → '/clone'.
    // If guard order were reversed (idempotency before containment), the git-root
    // collapse would make the path match the existing clone entry and return
    // 'alreadyAssigned' — a spurious success.
    // Correct order (containment guard 4 before idempotency guard 6) ensures
    // ERR_ASSIGN_CONTAINMENT is thrown regardless of git-root resolution.
    const subdir = path.join(cloneDir, 'src');
    fs.mkdirSync(subdir, { recursive: true });

    await expect(
      runAssign({
        callsignOrUrl: 'alpha',
        registryPath,
        cwd: subdir,
        // Simulates real git: root always resolves to parent clone root.
        getGitRoot: () => cloneDir,
        getRemoteUrls: () => [],
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CONTAINMENT/);
  });
});

// ============================================================
// S1 / S7 — git clone URL passed through as a literal string
// ============================================================

describe('runAssign: URL argument handling', () => {
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    cloneDir = makeDir('product-clone');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, []);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A22 URL starting with -- is passed to cloneCommand as a literal string, not a git flag', async () => {
    const capturedUrls: string[] = [];
    const cloneDest = path.join(TEST_ROOT, 'evil-dest');

    await expect(
      runAssign({
        callsignOrUrl: '--upload-pack=/bad/binary',
        cloneTo: cloneDest,
        registryPath,
        cwd: cloneDir,
        getGitRoot: (dir) => dir,
        getRemoteUrls: () => [],
        cloneCommand: async (url, _dest) => {
          capturedUrls.push(url);
          throw new Error('not a real git server');
        },
      }),
    ).rejects.toThrow(/ERR_ASSIGN_CLONE_FAILED/);

    // The URL must reach cloneCommand verbatim — not parsed as a git flag.
    expect(capturedUrls[0]).toBe('--upload-pack=/bad/binary');
  });
});

// ============================================================
// F7 — cold-start orphan removal on registry write failure
// ============================================================

describe('runAssign: cold-start registry write failure rollback', () => {
  let cloneDir: string;
  let registryPath: string;
  let cloneDest: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    cloneDir = makeDir('product-clone');
    cloneDest = path.join(TEST_ROOT, 'squad-host');
    registryPath = path.join(TEST_ROOT, 'registry.json');
    writeRegistry(registryPath, []);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A23 orphan clone removed when registry write fails after successful clone', async () => {
    const cloneCommand = async (_url: string, dest: string) => {
      fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
      fs.writeFileSync(path.join(dest, '.squad', 'team.md'), '# Team\n');
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
        _writeRegistryFn: () => { throw new Error('disk full'); },
      }),
    ).rejects.toThrow('disk full');

    // Orphan clone must be removed — no directory left without a registry reference.
    expect(fs.existsSync(cloneDest)).toBe(false);
  });
});

// ============================================================
// F2 — multi-clone growth test (same callsign, two distinct clones)
// ============================================================

describe('runAssign: multi-clone growth', () => {
  let hostDir: string;
  let cloneDir1: string;
  let cloneDir2: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir1 = makeDir('clone1');
    cloneDir2 = makeDir('clone2');
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

  it('A24 assigning two distinct clone directories grows clones[] to length 2 without duplication', async () => {
    const opts: Omit<SquadAssignOpts, 'cwd'> = {
      callsignOrUrl: 'alpha',
      registryPath,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    };

    await runAssign({ ...opts, cwd: cloneDir1 });
    await runAssign({ ...opts, cwd: cloneDir2 });

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    const clones = entry['clones'] as string[];
    expect(clones).toHaveLength(2);
    expect(clones).toContain(cloneDir1);
    expect(clones).toContain(cloneDir2);
  });
});

// ============================================================
// F4 — A5 extended: assert clones[] after reactivation
// ============================================================

describe('runAssign: reactivation clone binding', () => {
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

  it('A5b reactivation binds the new clone directory into clones[]', async () => {
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    }) satisfies SquadAssignResult;

    expect(result.kind satisfies AssignKind).toBe('reactivated');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    expect(entry['status']).toBe('active');
    // F4: the newly assigned clone path must be bound in clones[].
    expect((entry['clones'] as string[])).toContain(cloneDir);
  });
});

// ============================================================
// F5 — warm path leaves product repo filesystem untouched
// ============================================================

describe('runAssign: no writes to product clone directory', () => {
  let hostDir: string;
  let cloneDir: string;
  let registryPath: string;

  beforeEach(() => {
    fs.mkdirSync(TEST_ROOT, { recursive: true });
    hostDir = makeDir('host');
    const squadPath = makeSquadHost(hostDir);
    cloneDir = makeDir('clone');
    // Create a sentinel file so the listing is non-empty and predictable.
    fs.writeFileSync(path.join(cloneDir, 'app.ts'), '// app\n');
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

  it('A25 warm path does not write any files into the product clone directory', async () => {
    const before = fs.readdirSync(cloneDir).sort();

    await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    const after = fs.readdirSync(cloneDir).sort();
    expect(after).toEqual(before);
  });
});

// ============================================================
// F6 — forward-compat: sibling entries' unknown fields survive assign
// ============================================================

describe('runAssign: forward-compat preserves sibling entry fields', () => {
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
    // Two entries: alpha (target) and beta (sibling with unknown field).
    writeRegistry(registryPath, [
      { callsign: 'alpha', path: squadPath, origins: [], clones: [] },
      { callsign: 'beta', path: squadPath2, origins: [], clones: [], _siblingFutureField: 'must-survive' },
    ]);
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('A26 sibling entry unknown fields survive when assigning to a different entry', async () => {
    await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [],
    });

    const reg = readRegistry(registryPath);
    const beta = (reg.squads as Record<string, unknown>[]).find(s => s['callsign'] === 'beta')!;
    expect(beta['_siblingFutureField']).toBe('must-survive');
  });
});

// ============================================================
// Origins dedup at write boundary
// ============================================================

describe('runAssign: origins dedup at write boundary', () => {
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

  it('A27 getRemoteUrls returning repeated URLs persists each unique origin exactly once', async () => {
    // Inject a seam that returns three copies of the same URL — the write
    // boundary must collapse them to a single entry in origins[].
    const result = await runAssign({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [
        'https://github.com/owner/repo.git',
        'https://github.com/owner/repo.git',
        'https://github.com/owner/repo.git',
      ],
    });

    expect(result.kind).toBe('assigned');

    const reg = readRegistry(registryPath);
    const entry = (reg.squads as Record<string, unknown>[])[0]!;
    const origins = entry['origins'] as string[];

    // The three identical URLs must appear in origins as a single normalized entry.
    expect(origins.filter(o => o === 'github.com/owner/repo')).toHaveLength(1);

    // Verify with two distinct URLs each repeated: dedup keeps one of each.
    const cloneDir2 = makeDir('clone2');
    const hostDir2 = makeDir('host2');
    const squadPath2 = makeSquadHost(hostDir2);
    const registryPath2 = path.join(TEST_ROOT, 'registry2.json');
    writeRegistry(registryPath2, [{
      callsign: 'bravo',
      path: squadPath2,
      origins: [],
      clones: [],
    }]);

    await runAssign({
      callsignOrUrl: 'bravo',
      registryPath: registryPath2,
      cwd: cloneDir2,
      getGitRoot: (dir) => dir,
      getRemoteUrls: () => [
        'https://github.com/owner/repo.git',
        'https://github.com/owner/repo.git',
        'https://github.com/owner/fork.git',
        'https://github.com/owner/fork.git',
      ],
    });

    const reg2 = readRegistry(registryPath2);
    const entry2 = (reg2.squads as Record<string, unknown>[])[0]!;
    const origins2 = entry2['origins'] as string[];

    // Two distinct normalized origins, each appearing exactly once.
    expect(origins2).toHaveLength(2);
    expect(origins2.filter(o => o === 'github.com/owner/repo')).toHaveLength(1);
    expect(origins2.filter(o => o === 'github.com/owner/fork')).toHaveLength(1);
  });
});
