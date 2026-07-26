import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runAssign, AssignError } from '../../packages/squad-cli/src/commands/assign.js';
import type { SquadAssignOpts } from '../../packages/squad-cli/src/commands/assign.js';
import { writeRegistry } from '../../packages/squad-sdk/src/registry.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.assign-p32-tmp');

function makeTmpDir(name: string): string {
  const dir = path.join(TMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Build a minimal squad host at `hostDir/.squad` with a team.md file. */
function makeSquadHost(hostDir: string, callsign: string): string {
  const squadDir = path.join(hostDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# ${callsign}\n`, 'utf8');
  return squadDir;
}

/** Write a registry with one squad entry. */
function makeRegistry(registryPath: string, squadDir: string, callsign: string, extra: Record<string, unknown> = {}): void {
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  writeRegistry(registryPath, {
    version: 1,
    squads: [{ callsign, path: squadDir, ...extra }],
  });
}

/** A no-op clone command — writes .squad/team.md at dest. */
async function fakeClone(url: string, dest: string): Promise<void> {
  const squadDir = path.join(dest, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# cloned\n`, 'utf8');
}

/** Shared seam defaults for unit tests. */
function baseOpts(overrides: Partial<SquadAssignOpts>): SquadAssignOpts {
  return {
    noInstallAgent: true,
    copilotHome: path.join(TMP_ROOT, 'copilot-home'),
    ...overrides,
  };
}

describe('squad assign — piece-32 state fields (warm path)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir('warm');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P32.A1 --state-remote is accepted and persisted on the registry entry', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      stateRemote: 'upstream',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ stateRemote: 'upstream' });
  });

  it('P32.A2 --state-branch is accepted and persisted on the registry entry', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      stateBranch: 'my-state',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ stateBranch: 'my-state' });
  });

  it('P32.A3 --inbox-handle is accepted and persisted on the registry entry', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      inboxHandle: 'dev1',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ inboxHandle: 'dev1' });
  });

  it('P32.A4 omitted flags leave stateRemote/stateBranch absent on fresh entry', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    const entry = written[0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty('stateRemote');
    expect(entry).not.toHaveProperty('stateBranch');
  });

  it('P32.A5 re-assign without --state-remote preserves existing stateRemote value', async () => {
    const hostDir = path.join(dir, 'host');
    const clone1 = path.join(dir, 'clone1');
    const clone2 = path.join(dir, 'clone2');
    fs.mkdirSync(clone1, { recursive: true });
    fs.mkdirSync(clone2, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    // Pre-populate with stateRemote already set.
    makeRegistry(registryPath, squadDir, 'alpha', { stateRemote: 'upstream', clones: [clone1] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: clone2,
      // stateRemote NOT supplied — must preserve existing value
      getGitRoot: () => clone2,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ stateRemote: 'upstream' });
  });

  it('P32.A6 invalid --inbox-handle throws AssignError with INVALID_ALIAS before registry read', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      inboxHandle: '--bad',
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A7 invalid --inbox-handle uppercase throws INVALID_ALIAS', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      inboxHandle: 'BAD',
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A8 invalid --inbox-handle too long throws INVALID_ALIAS', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      inboxHandle: 'a'.repeat(40),
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A9 valid --inbox-handle passes validation', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      inboxHandle: 'alice-2',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ inboxHandle: 'alice-2' });
  });
});

describe('squad assign — piece-32 state fields (cold-start path)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir('cold');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P32.B1 cold-start: --state-remote persisted on new registry entry', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    const registryDir = path.dirname(registryPath);
    fs.mkdirSync(registryDir, { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/squad.git',
      cloneTo: cloneDir,
      callsign: 'squad',
      registryPath,
      cwd: productClone,
      stateRemote: 'origin',
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: fakeClone,
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'squad')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ stateRemote: 'origin' });
  });

  it('P32.B2 cold-start: --state-branch persisted on new registry entry', async () => {
    const cloneDir = path.join(dir, 'dest2');
    const productClone = path.join(dir, 'product2');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/squad.git',
      cloneTo: cloneDir,
      callsign: 'squad2',
      registryPath,
      cwd: productClone,
      stateBranch: 'my-branch',
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: fakeClone,
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'squad2')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ stateBranch: 'my-branch' });
  });

  it('P32.B3 cold-start: --inbox-handle persisted on new registry entry', async () => {
    const cloneDir = path.join(dir, 'dest3');
    const productClone = path.join(dir, 'product3');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/squad.git',
      cloneTo: cloneDir,
      callsign: 'squad3',
      registryPath,
      cwd: productClone,
      inboxHandle: 'dev1',
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: fakeClone,
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'squad3')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ inboxHandle: 'dev1' });
  });

  // P32.B4
  it('P32.B4 cold-start re-assign (reactivating) without state flags preserves existing stateRemote/stateBranch/inboxHandle', async () => {
    // Reactivation scenario: registry already has an entry for this callsign (with state
    // fields set) but the clone directory no longer exists. Re-running with --clone-to
    // re-clones and must preserve the existing state fields on the merged entry.
    const cloneDir = path.join(dir, 'dest4');
    const productClone = path.join(dir, 'product4');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    // Pre-seed a registry entry whose path points to where the clone command will land.
    // cloneDir must NOT exist yet so the non-empty guard passes.
    const preSeedSquadDir = path.join(cloneDir, '.squad');
    writeRegistry(registryPath, {
      version: 1,
      squads: [{
        callsign: 'squad4',
        path: preSeedSquadDir,
        stateRemote: 'upstream',
        stateBranch: 'my-state',
        inboxHandle: 'alice',
        status: 'inactive' as const,
      }],
    });

    const written: unknown[] = [];

    // Re-assign (reactivating) WITHOUT --state-remote / --state-branch / --inbox-handle.
    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/squad4.git',
      cloneTo: cloneDir,
      callsign: 'squad4',
      registryPath,
      cwd: productClone,
      // state flags intentionally omitted — must preserve existing values from registry
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: fakeClone,
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'squad4')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({
      stateRemote: 'upstream',
      stateBranch: 'my-state',
      inboxHandle: 'alice',
    });
  });
});

// ─── Piece 34 — cross-repo hook installation ────────────────────────────────

describe('squad assign — piece-34 cross-repo hook installation (warm path)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir('p34');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P34.A1 inboxHandle set → installCrossRepoHook called with the host git root (root host)', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const hookCalls: string[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      inboxHandle: 'dev1',
      // Piece 50 §C: the host git root is resolved via git rev-parse from the team-root dir.
      // For a root host the team-root dir IS the host git root, so identity resolution models
      // a real work tree where `git rev-parse --show-toplevel` returns the dir itself.
      getGitRoot: (d) => d,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    // The warm path installs the cross-repo hook in BOTH clones: host (first) then product.
    // Piece 50 §C only changes the host-side root; the host install must target the host git root.
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0]).toBe(hostDir);
    expect(hookCalls[1]).toBe(cloneDir);
  });

  it('P50.C subfolder host → installCrossRepoHook called with the host git root, not the callsign subdir', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    // Subfolder host: the team root is <hostDir>/alpha/.squad.
    const squadDir = makeSquadHost(path.join(hostDir, 'alpha'), 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const hookCalls: string[] = [];
    const teamRootDir = path.normalize(path.join(hostDir, 'alpha'));

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      inboxHandle: 'dev1',
      // git rev-parse --show-toplevel from the subfolder team-root dir resolves the HOST git
      // root (<hostDir>), never the <hostDir>/alpha subdirectory. Every other dir (the product
      // clone) resolves to itself.
      getGitRoot: (d) => (path.normalize(d) === teamRootDir ? hostDir : d),
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    // Host install (first) targets the resolved host git root, NOT the callsign subdir;
    // the product install (second) targets the product clone, unchanged.
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0]).toBe(hostDir);
    expect(hookCalls[0]).not.toBe(teamRootDir);
    expect(hookCalls[1]).toBe(cloneDir);
  });

  it('P34.A2 inboxHandle set but hook throws → warning emitted, assign succeeds (no throw)', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const result = await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      inboxHandle: 'dev1',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: () => { throw new Error('simulated: not a git repo'); },
    }));

    // Assign must succeed
    expect(result.kind).toBe('assigned');

    // Warning must be emitted
    if (result.kind === 'assigned' || result.kind === 'reactivated') {
      expect(result.warnings.some(w => w.includes('simulated: not a git repo'))).toBe(true);
    }
  });

  it('P34.A3 inboxHandle not set → installCrossRepoHook not called', async () => {
    const hostDir = path.join(dir, 'host');
    const cloneDir = path.join(dir, 'clone');
    fs.mkdirSync(cloneDir, { recursive: true });
    const squadDir = makeSquadHost(hostDir, 'alpha');
    const registryPath = path.join(dir, 'registry.json');
    makeRegistry(registryPath, squadDir, 'alpha');

    const hookCalls: string[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      registryPath,
      cwd: cloneDir,
      // inboxHandle intentionally omitted
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    expect(hookCalls).toHaveLength(0);
  });
});

// ─── Piece 49 — subfolder team-root resolution ──────────────────────────────

describe('squad assign — piece-49 subfolder team-root resolution (warm path)', () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir('p49');
  });

  afterEach(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('P49.C1 .squad/team.md at clone root assigns as today (regression)', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/host.git',
      cloneTo: cloneDir,
      callsign: 'alpha',
      registryPath,
      cwd: productClone,
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: async (_url: string, dest: string) => {
        const sq = path.join(dest, '.squad');
        fs.mkdirSync(sq, { recursive: true });
        fs.writeFileSync(path.join(sq, 'team.md'), '# alpha\n', 'utf8');
      },
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    const entry = written[0] as Record<string, unknown>;
    expect(entry).toBeDefined();
    // Root host: entry.path should end with /.squad (not callsign-prefixed)
    expect((entry['path'] as string).replace(/\\/g, '/')).toContain('dest/.squad');
    expect((entry['path'] as string).replace(/\\/g, '/')).not.toContain('alpha/.squad');
  });

  it('P49.C2 <callsign>/.squad/team.md assigns and registers subfolder .squad', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/host.git',
      cloneTo: cloneDir,
      callsign: 'bravo',
      registryPath,
      cwd: productClone,
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: async (_url: string, dest: string) => {
        // Subfolder layout: <dest>/bravo/.squad/team.md
        const sq = path.join(dest, 'bravo', '.squad');
        fs.mkdirSync(sq, { recursive: true });
        fs.writeFileSync(path.join(sq, 'team.md'), '# bravo\n', 'utf8');
      },
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'bravo')); writeRegistry(_fp, reg); },
    }));

    const entry = written[0] as Record<string, unknown>;
    expect(entry).toBeDefined();
    // Subfolder host: entry.path should be <cloneDir>/bravo/.squad
    expect((entry['path'] as string).replace(/\\/g, '/')).toContain('bravo/.squad');
  });

  it('P49.C3 neither root nor callsign subdir → ERR_ASSIGN_NO_TEAM_MD naming both paths + clone rolled back', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const err = await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/host.git',
      cloneTo: cloneDir,
      callsign: 'charlie',
      registryPath,
      cwd: productClone,
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: async (_url: string, dest: string) => {
        // No .squad anywhere
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, 'README.md'), '# hi\n', 'utf8');
      },
    })).catch(e => e);

    expect(err).toBeInstanceOf(AssignError);
    expect((err as AssignError).code).toBe('ERR_ASSIGN_NO_TEAM_MD');
    // Error message should mention both paths
    expect((err as AssignError).message).toContain('.squad');
    expect((err as AssignError).message).toContain('charlie');
    // Clone should be rolled back
    expect(fs.existsSync(cloneDir)).toBe(false);
  });

  it('P49.C4 differently-named subdir (not callsign) → still fails (no arbitrary scan)', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistry(registryPath, { version: 1, squads: [] });

    const err = await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/host.git',
      cloneTo: cloneDir,
      callsign: 'delta',
      registryPath,
      cwd: productClone,
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: async (_url: string, dest: string) => {
        // A .squad/team.md exists in a subdir named "other", not "delta"
        const sq = path.join(dest, 'other', '.squad');
        fs.mkdirSync(sq, { recursive: true });
        fs.writeFileSync(path.join(sq, 'team.md'), '# other\n', 'utf8');
      },
    })).catch(e => e);

    expect(err).toBeInstanceOf(AssignError);
    expect((err as AssignError).code).toBe('ERR_ASSIGN_NO_TEAM_MD');
  });

  it('P49.C5 subfolder-registered host can be reactivated without collision error', async () => {
    const cloneDir = path.join(dir, 'dest');
    const productClone = path.join(dir, 'product');
    fs.mkdirSync(productClone, { recursive: true });
    const registryPath = path.join(dir, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    // Pre-seed a registry entry for a subfolder host (as piece 49 C would create).
    const subfolderSquadDir = path.join(cloneDir, 'echo', '.squad');
    writeRegistry(registryPath, {
      version: 1,
      squads: [{
        callsign: 'echo',
        path: subfolderSquadDir,
        status: 'inactive' as const,
      }],
    });

    const written: unknown[] = [];

    await runAssign(baseOpts({
      callsignOrUrl: 'https://example.com/host.git',
      cloneTo: cloneDir,
      callsign: 'echo',
      registryPath,
      cwd: productClone,
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: async (_url: string, dest: string) => {
        // Subfolder layout: <dest>/echo/.squad/team.md
        const sq = path.join(dest, 'echo', '.squad');
        fs.mkdirSync(sq, { recursive: true });
        fs.writeFileSync(path.join(sq, 'team.md'), '# echo\n', 'utf8');
      },
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'echo')); writeRegistry(_fp, reg); },
    }));

    const entry = written[0] as Record<string, unknown>;
    expect(entry).toBeDefined();
    // Must resolve to the subfolder .squad path (reactivation succeeded, no collision)
    expect((entry['path'] as string).replace(/\\/g, '/')).toContain('echo/.squad');
  });
});
