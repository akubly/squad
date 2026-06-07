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

  it('P32.A3 --developer-alias is accepted and persisted on the registry entry', async () => {
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
      developerAlias: 'dev1',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ developerAlias: 'dev1' });
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

  it('P32.A6 invalid --developer-alias throws AssignError with INVALID_ALIAS before registry read', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      developerAlias: '--bad',
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A7 invalid --developer-alias uppercase throws INVALID_ALIAS', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      developerAlias: 'BAD',
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A8 invalid --developer-alias too long throws INVALID_ALIAS', async () => {
    await expect(runAssign(baseOpts({
      callsignOrUrl: 'alpha',
      developerAlias: 'a'.repeat(40),
      getGitRoot: () => null,
      getRemoteUrls: () => [],
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'INVALID_ALIAS',
    );
  });

  it('P32.A9 valid --developer-alias passes validation', async () => {
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
      developerAlias: 'alice-2',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'alpha')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ developerAlias: 'alice-2' });
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

  it('P32.B3 cold-start: --developer-alias persisted on new registry entry', async () => {
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
      developerAlias: 'dev1',
      getGitRoot: () => productClone,
      getRemoteUrls: () => [],
      cloneCommand: fakeClone,
      _writeRegistryFn: (_fp, reg) => { written.push(reg.squads.find(s => s.callsign === 'squad3')); writeRegistry(_fp, reg); },
    }));

    expect(written[0]).toMatchObject({ developerAlias: 'dev1' });
  });

  // P32.B4
  it('P32.B4 cold-start re-assign (reactivating) without state flags preserves existing stateRemote/stateBranch/developerAlias', async () => {
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
        developerAlias: 'alice',
        status: 'inactive' as const,
      }],
    });

    const written: unknown[] = [];

    // Re-assign (reactivating) WITHOUT --state-remote / --state-branch / --developer-alias.
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
      developerAlias: 'alice',
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

  it('P34.A1 developerAlias set → installCrossRepoHook called with path.dirname(entry.path)', async () => {
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
      developerAlias: 'dev1',
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    // installCrossRepoHook must be called once with the docs-repo root (parent of .squad)
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]).toBe(hostDir);
  });

  it('P34.A2 developerAlias set but hook throws → warning emitted, assign succeeds (no throw)', async () => {
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
      developerAlias: 'dev1',
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

  it('P34.A3 developerAlias not set → installCrossRepoHook not called', async () => {
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
      // developerAlias intentionally omitted
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: (p) => { hookCalls.push(p); },
    }));

    expect(hookCalls).toHaveLength(0);
  });
});
