/**
 * Piece 40 — Callsign-namespaced transport.
 *
 * Tests for sub-proposals A–D and the two-squad integration scenario:
 *   A: Callsign-namespaced inbox branches (sync.ts / publishTeamRootToInbox)
 *   B: Callsign-namespaced state branch default (init.ts)
 *   C: install-fold-pipeline --callsign parameterization
 *   D: Origin-ambiguity guard verification (assign.ts:530-544)
 *   Integration: Two squads, one remote, independent publish/pull
 */

// ─── Mocks (must come before all imports per Vitest hoisting rules) ───────────
vi.mock('@bradygaster/squad-sdk/registry', async (importActual) => {
  const actual = await importActual<typeof import('@bradygaster/squad-sdk/registry')>();
  return {
    ...actual,
    loadRegistryFromDisk: vi.fn(),
    writeRegistry: vi.fn(),
  };
});
vi.mock('@bradygaster/squad-sdk/path-utils', () => ({
  normalisedPathKey: vi.fn((p: string) => p.toLowerCase().replace(/\\/g, '/')),
}));
vi.mock('@bradygaster/squad-sdk/validation', () => ({
  INBOX_HANDLE_RE: /^[a-z][a-z0-9-]{1,38}$/,
  CALLSIGN_RE: /^[a-z][a-z0-9-]{1,38}$/,
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Template root — used by M5 byte-identical assertions.
const TEMPLATES_ROOT = path.join(process.cwd(), 'packages', 'squad-cli', 'templates', 'fold');

import {
  publishTeamRootToInbox,
  runSync,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  installFoldPipeline,
  type InstallFoldPipelineOptions,
} from '../../packages/squad-cli/src/cli/commands/install-fold-pipeline.js';
import { runInit } from '../../packages/squad-cli/src/commands/init.js';
import { runAssign, AssignError } from '../../packages/squad-cli/src/commands/assign.js';
import type { SquadAssignOpts } from '../../packages/squad-cli/src/commands/assign.js';
import { loadRegistryFromDisk, writeRegistry } from '@bradygaster/squad-sdk/registry';
import { normalisedPathKey } from '@bradygaster/squad-sdk/path-utils';
import type { Registry } from '@bradygaster/squad-sdk/registry';
import { writeRegistry as writeRegistryDirect } from '../../packages/squad-sdk/src/registry.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.piece-40-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initBareRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', dir], { stdio: 'pipe' });
}

function initWorkingRepo(dir: string, remoteName: string, remoteUrl: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', remoteName, remoteUrl], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad', 'decisions', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions', 'inbox', 'item.md'), '# Item\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'log', 'session.md'), '# Log\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'sessions', 'session.json'), '{}');
}

function listBareRefs(bareDir: string): string[] {
  try {
    return execFileSync('git', ['--git-dir', bareDir, 'for-each-ref', '--format=%(refname)'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function showBareFile(bareDir: string, refAndPath: string): string {
  return execFileSync('git', ['--git-dir', bareDir, 'show', refAndPath], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

/** Build a minimal squad host at `hostDir/.squad` with a team.md file. */
function makeSquadHost(hostDir: string, callsign: string): string {
  const squadDir = path.join(hostDir, '.squad');
  fs.mkdirSync(squadDir, { recursive: true });
  fs.writeFileSync(path.join(squadDir, 'team.md'), `# ${callsign}\n`, 'utf8');
  return squadDir;
}

function makeRegistryFile(registryPath: string, squadDir: string, callsign: string, extra: Record<string, unknown> = {}): void {
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  writeRegistryDirect(registryPath, {
    version: 1,
    squads: [{ callsign, path: squadDir, ...extra }],
  });
}

function baseAssignOpts(overrides: Partial<SquadAssignOpts>): SquadAssignOpts {
  return {
    noInstallAgent: true,
    copilotHome: path.join(TMP_ROOT, 'copilot-home'),
    ...overrides,
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  vi.mocked(normalisedPathKey).mockImplementation((p: string) => p.toLowerCase().replace(/\\/g, '/'));
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ═══════════════════════════════════════════════════════════════════════════
// Sub-proposal A — Callsign-namespaced inbox branches
// ═══════════════════════════════════════════════════════════════════════════

describe('A — Callsign-namespaced inbox branches', { timeout: 60_000 }, () => {
  it('A1: cross-repo push builds squad/inbox/<callsign>/<handle>/... branch', async () => {
    const base = makeTmpDir('a1-cross-repo');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-a1', 'team-a');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('refs/heads/squad/inbox/'));
    expect(inboxRefs).toHaveLength(1);
    // Must contain callsign before handle
    expect(inboxRefs[0]).toContain('/squad/inbox/team-a/dev1/');
    expect(inboxRefs[0]).toContain('sess-a1');
  });

  it('A2: publish-metadata.json contains callsign field', async () => {
    const base = makeTmpDir('a2-metadata');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-a2', 'team-a');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/team-a/dev1/'));
    expect(inboxRef).toBeTruthy();

    const rawMeta = showBareFile(bare, `${inboxRef}:.squad/publish-metadata.json`);
    const meta = JSON.parse(rawMeta);
    expect(meta.callsign).toBe('team-a');
    expect(meta.inboxHandle).toBe('dev1');
  });

  it('A3: invalid callsign rejects before any git operation', async () => {
    const base = makeTmpDir('a3-callsign-invalid');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    const badCallsigns = ['UPPERCASE', '-bad', 'a'.repeat(40), ''];
    for (const cs of badCallsigns) {
      if (cs === '') {
        // empty string is undefined-like — treated as no callsign → 2-component
        // (tested in A5). Skip empty here.
        continue;
      }
      await expect(
        publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-x', cs),
      ).rejects.toThrow(/Invalid callsign/);
    }

    const refs = listBareRefs(bare);
    expect(refs.filter(r => r.includes('/squad/inbox/'))).toHaveLength(0);
  });

  it('A4: unset callsign in cross-repo runSync → fatal error (process.exit + clear message)', async () => {
    const base = makeTmpDir('a4-no-callsign');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    const workGitRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    // Registry entry WITHOUT a callsign field
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'dev1',
        // callsign intentionally absent
      }]),
      warnings: [],
    });

    process.env['COPILOT_SESSION_ID'] = 'test-session-a4';

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        runSync({ direction: 'push', cwd: workRepo, quiet: true }),
      ).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const errMsg = errSpy.mock.calls.map(a => a.join(' ')).join('\n');
      expect(errMsg).toContain('callsign');
      expect(errMsg).toContain('squad assign');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('A5: no callsign (undefined) → 2-component branch preserved (single-repo-style compat)', async () => {
    const base = makeTmpDir('a5-no-callsign-two-component');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // Call without callsign parameter → should use 2-component branch
    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-a5');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/'));
    expect(inboxRefs).toHaveLength(1);
    // Must be 2-component: squad/inbox/dev1/<ts>... NOT squad/inbox/<callsign>/dev1/...
    expect(inboxRefs[0]).toMatch(/refs\/heads\/squad\/inbox\/dev1\//);
    // Must NOT have an extra segment before dev1
    const afterInbox = inboxRefs[0]!.replace('refs/heads/squad/inbox/', '');
    expect(afterInbox.startsWith('dev1/')).toBe(true);
  });

  it('A6: cross-repo runSync with valid callsign creates namespaced inbox branch', async () => {
    const base = makeTmpDir('a6-runsync-callsign');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    const workGitRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'team-a',
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });

    process.env['COPILOT_SESSION_ID'] = 'test-session-a6';

    await runSync({ direction: 'push', cwd: workRepo, developer: 'dev1', quiet: true });

    const refs = listBareRefs(docsRemote);
    const inboxRefs = refs.filter(r => r.includes('refs/heads/squad/inbox/team-a/dev1/'));
    expect(inboxRefs).toHaveLength(1);
    expect(inboxRefs[0]).toContain('test-session-a6');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sub-proposal B — Callsign-namespaced state branch default (init)
// ═══════════════════════════════════════════════════════════════════════════

describe('B — Callsign-namespaced state branch (init)', { timeout: 30_000 }, () => {
  it('B1: squad init --callsign <name> writes stateBranch "squad/state/<name>" to registry entry', async () => {
    const base = makeTmpDir('b1-init-callsign');
    const registryPath = path.join(base, 'registry.json');

    const result = await runInit({
      targetDir: base,
      callsign: 'team-a',
      registryPath,
      cwd: base,
    });

    expect(result.registered?.callsign).toBe('team-a');

    // writeRegistry is mocked as vi.fn() — verify it was called with stateBranch set
    const calls = vi.mocked(writeRegistry).mock.calls;
    const writtenRegistry = calls.find(([p]) => p === registryPath || p.endsWith('registry.json'))?.[1];
    expect(writtenRegistry).toBeDefined();
    const entry = writtenRegistry?.squads.find(s => s.callsign === 'team-a');
    expect(entry).toBeDefined();
    expect(entry!.stateBranch).toBe('squad/state/team-a');
  });

  it('B2: squad sync --pull for entry with stateBranch "squad/state/<name>" fetches from that branch', async () => {
    const base = makeTmpDir('b2-pull-state-branch');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    const workGitRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'team-a',
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad/state/team-a',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });

    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(
      expect.any(String),
      'origin',
      'squad/state/team-a',
    );
    hydrateSpy.mockRestore();
  });

  it('B3: existing entry with stateBranch "squad-state" still pulls from squad-state', async () => {
    const base = makeTmpDir('b3-legacy-state-branch');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    const workGitRoot = initWorkingRepo(workRepo, 'origin', docsRemote);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'legacy-squad',
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });

    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(
      expect.any(String),
      'origin',
      'squad-state',
    );
    hydrateSpy.mockRestore();
  });

  it('B4: squad init without --callsign does NOT set stateBranch on registry entry', async () => {
    const base = makeTmpDir('b4-no-callsign');
    const registryPath = path.join(base, 'registry.json');
    const targetDir = path.join(base, 'proj');
    fs.mkdirSync(targetDir, { recursive: true });

    await runInit({
      targetDir,
      // callsign not provided — basename fallback used
      registryPath,
      cwd: base,
    });

    // writeRegistry is mocked — verify stateBranch was NOT written when callsign absent
    const calls = vi.mocked(writeRegistry).mock.calls;
    const writtenRegistry = calls.find(([p]) => p === registryPath || p.endsWith('registry.json'))?.[1];
    expect(writtenRegistry).toBeDefined();
    const entry = writtenRegistry?.squads[0];
    expect(entry).toBeDefined();
    // stateBranch must NOT be set when callsign was not explicitly provided
    expect(entry!.stateBranch).toBeUndefined();
  });

  it('M3: squad init --callsign with invalid value rejects before any registry write', async () => {
    const base = makeTmpDir('m3-invalid-callsign');
    const registryPath = path.join(base, 'registry.json');
    const targetDir = path.join(base, 'proj');
    fs.mkdirSync(targetDir, { recursive: true });

    const badCallsigns = ['Bad/Name', 'UPPER', '-bad', '1squad', 'a'];
    for (const cs of badCallsigns) {
      await expect(
        runInit({ targetDir, callsign: cs, registryPath, cwd: base }),
      ).rejects.toSatisfy((err: unknown) =>
        err instanceof Error && err.message.includes('ERR_SQUAD_INIT_INVALID_CALLSIGN'),
      );
    }

    // writeRegistry must NOT have been called for any invalid callsign.
    expect(vi.mocked(writeRegistry).mock.calls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H2 — squad assign cold-start stateBranch defaulting
// ═══════════════════════════════════════════════════════════════════════════

describe('H2 — assign cold-start stateBranch defaulting', { timeout: 30_000 }, () => {
  /** Build a fake host-clone directory that _coldStart accepts (.squad/team.md present). */
  async function makeCloneCommand(dest: string): Promise<void> {
    fs.mkdirSync(path.join(dest, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(dest, '.squad', 'team.md'), '# squad\n');
  }

  it('H2-1: cold-start with --callsign team-b, no --state-branch → new entry has stateBranch squad/state/team-b', async () => {
    const base = makeTmpDir('h2-1-new-entry');
    const cloneTo = path.join(base, 'host-clone');
    const productDir = path.join(base, 'product');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([]),
      warnings: [],
    });

    const written: Registry[] = [];
    await runAssign(baseAssignOpts({
      callsignOrUrl: 'https://example.com/team-b.git',
      callsign: 'team-b',
      cloneTo,
      registryPath,
      cwd: base,
      getGitRoot: () => productDir,
      getRemoteUrls: () => [],
      cloneCommand: (_url, dest) => makeCloneCommand(dest),
      _writeRegistryFn: (_p, reg) => { written.push(reg); },
      _installCrossRepoHookFn: () => {},
    }));

    const entry = written[0]?.squads.find(s => s.callsign === 'team-b');
    expect(entry).toBeDefined();
    expect(entry!.stateBranch).toBe('squad/state/team-b');
  });

  it('H2-2: explicit --state-branch overrides the callsign default', async () => {
    const base = makeTmpDir('h2-2-explicit-state-branch');
    const cloneTo = path.join(base, 'host-clone');
    const productDir = path.join(base, 'product');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([]),
      warnings: [],
    });

    const written: Registry[] = [];
    await runAssign(baseAssignOpts({
      callsignOrUrl: 'https://example.com/team-b.git',
      callsign: 'team-b',
      cloneTo,
      stateBranch: 'custom/state/branch',
      registryPath,
      cwd: base,
      getGitRoot: () => productDir,
      getRemoteUrls: () => [],
      cloneCommand: (_url, dest) => makeCloneCommand(dest),
      _writeRegistryFn: (_p, reg) => { written.push(reg); },
      _installCrossRepoHookFn: () => {},
    }));

    const entry = written[0]?.squads.find(s => s.callsign === 'team-b');
    expect(entry).toBeDefined();
    expect(entry!.stateBranch).toBe('custom/state/branch');
  });

  it('H2-3: reactivating an existing entry does NOT clobber its stateBranch', async () => {
    const base = makeTmpDir('h2-3-reactivate');
    const existingHostPath = path.join(base, 'host-clone');
    const cloneTo = existingHostPath;
    const productDir = path.join(base, 'product');
    const registryPath = path.join(base, 'registry.json');
    const squadDir = path.join(existingHostPath, '.squad');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    // Existing entry with a custom stateBranch (e.g., migrated manually)
    const existingEntry = {
      callsign: 'team-b',
      path: squadDir,
      stateBranch: 'squad/state/team-b-custom',
      clones: [] as string[],
      origins: [] as string[],
    };
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([existingEntry]),
      warnings: [],
    });

    const written: Registry[] = [];
    await runAssign(baseAssignOpts({
      callsignOrUrl: 'https://example.com/team-b.git',
      callsign: 'team-b',
      cloneTo,
      registryPath,
      cwd: base,
      getGitRoot: () => productDir,
      getRemoteUrls: () => [],
      cloneCommand: (_url, dest) => makeCloneCommand(dest),
      _writeRegistryFn: (_p, reg) => { written.push(reg); },
      _installCrossRepoHookFn: () => {},
    }));

    const entry = written[0]?.squads.find(s => s.callsign === 'team-b');
    expect(entry).toBeDefined();
    // Must preserve existing stateBranch — not override with squad/state/team-b.
    expect(entry!.stateBranch).toBe('squad/state/team-b-custom');
  });

  it('H2-4: invalid explicit --callsign in cold-start throws AssignError before any clone', async () => {
    const base = makeTmpDir('h2-4-invalid-callsign');
    const cloneTo = path.join(base, 'host-clone');
    const registryPath = path.join(base, 'registry.json');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: makeRegistry([]), warnings: [] });

    await expect(
      runAssign(baseAssignOpts({
        callsignOrUrl: 'https://example.com/bad.git',
        callsign: 'BAD/NAME',
        cloneTo,
        registryPath,
        cwd: base,
        getGitRoot: () => base,
        getRemoteUrls: () => [],
        cloneCommand: async () => { throw new Error('should not be called'); },
        _installCrossRepoHookFn: () => {},
      })),
    ).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.message.includes('Invalid --callsign'),
    );
  });

  it('H2-5: URL-derived invalid callsign (e.g. contains underscore) → assign succeeds with NO stateBranch (pre-piece-40 fallback preserved)', async () => {
    // URL segment "my_team.git" derives callsign "my_team" which fails CALLSIGN_RE.
    // Flight ruling (Option B): leave stateBranch undefined so ?? 'squad-state' fallback applies.
    const base = makeTmpDir('h2-5-url-derived-invalid');
    const cloneTo = path.join(base, 'host-clone');
    const productDir = path.join(base, 'product');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([]),
      warnings: [],
    });

    const written: Registry[] = [];
    await runAssign(baseAssignOpts({
      callsignOrUrl: 'https://example.com/my_team.git',
      // No explicit --callsign: derived callsign will be "my_team" (invalid per CALLSIGN_RE)
      cloneTo,
      registryPath,
      cwd: base,
      getGitRoot: () => productDir,
      getRemoteUrls: () => [],
      cloneCommand: (_url, dest) => makeCloneCommand(dest),
      _writeRegistryFn: (_p, reg) => { written.push(reg); },
      _installCrossRepoHookFn: () => {},
    }));

    const entry = written[0]?.squads.find(s => s.callsign === 'my_team');
    expect(entry).toBeDefined();
    // stateBranch must be absent — invalid derived callsign must not produce a malformed branch.
    expect(entry!.stateBranch).toBeUndefined();
  });

  it('H2-6: valid explicit --callsign with URL still gets stateBranch squad/state/<callsign> (regression guard)', async () => {
    const base = makeTmpDir('h2-6-explicit-callsign-regression');
    const cloneTo = path.join(base, 'host-clone');
    const productDir = path.join(base, 'product');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([]),
      warnings: [],
    });

    const written: Registry[] = [];
    await runAssign(baseAssignOpts({
      callsignOrUrl: 'https://example.com/my_team.git',
      callsign: 'team-b',
      cloneTo,
      registryPath,
      cwd: base,
      getGitRoot: () => productDir,
      getRemoteUrls: () => [],
      cloneCommand: (_url, dest) => makeCloneCommand(dest),
      _writeRegistryFn: (_p, reg) => { written.push(reg); },
      _installCrossRepoHookFn: () => {},
    }));

    const entry = written[0]?.squads.find(s => s.callsign === 'team-b');
    expect(entry).toBeDefined();
    expect(entry!.stateBranch).toBe('squad/state/team-b');
  });
});

describe('C — install-fold-pipeline --callsign', { timeout: 30_000 }, () => {
  function setupFoldRegistry(docsRepoDir: string, cloneRoot: string): void {
    const docsRepoRoot = initGitRepo(docsRepoDir);
    const squadDir = path.join(docsRepoRoot, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'test-squad',
        path: squadDir,
        clones: [cloneRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });
  }

  function initGitRepo(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  it('C1: --platform github --callsign team-a → trigger contains squad/inbox/team-a/**', async () => {
    const docsRepoDir = makeTmpDir('c1-gh-docs');
    const cloneDir = makeTmpDir('c1-gh-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir, callsign: 'team-a' });

    const content = fs.readFileSync(path.join(workflowsDir, 'fold-squad-state.yml'), 'utf-8');
    expect(content).toContain('squad/inbox/team-a/**');
    expect(content).not.toContain("'squad/inbox/**'");
  });

  it('C2: --platform github --callsign team-a → fold target contains squad/state/team-a', async () => {
    const docsRepoDir = makeTmpDir('c2-gh-target');
    const cloneDir = makeTmpDir('c2-gh-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir, callsign: 'team-a' });

    const content = fs.readFileSync(path.join(workflowsDir, 'fold-squad-state.yml'), 'utf-8');
    expect(content).toContain('squad/state/team-a');
    // The old hardcoded squad-state push must be replaced
    expect(content).not.toContain('HEAD:refs/heads/squad-state');
  });

  it('C3: --platform ado --callsign team-a → trigger contains refs/heads/squad/inbox/team-a/*', async () => {
    const docsRepoDir = makeTmpDir('c3-ado-docs');
    const cloneDir = makeTmpDir('c3-ado-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir, callsign: 'team-a' });
    } finally {
      consoleSpy.mockRestore();
    }

    const content = fs.readFileSync(path.join(pipelinesDir, 'fold-squad-state.yml'), 'utf-8');
    expect(content).toContain('refs/heads/squad/inbox/team-a/*');
    expect(content).not.toContain('- refs/heads/squad/inbox/*\n');
  });

  it('C4: --platform ado --callsign team-a → fold target contains squad/state/team-a', async () => {
    const docsRepoDir = makeTmpDir('c4-ado-target');
    const cloneDir = makeTmpDir('c4-ado-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir, callsign: 'team-a' });
    } finally {
      consoleSpy.mockRestore();
    }

    const content = fs.readFileSync(path.join(pipelinesDir, 'fold-squad-state.yml'), 'utf-8');
    expect(content).toContain('squad/state/team-a');
    expect(content).not.toContain('HEAD:refs/heads/squad-state');
  });

  it('C5: no --callsign → github template is byte-identical to raw template file', async () => {
    const docsRepoDir = makeTmpDir('c5-gh-noarg');
    const cloneDir = makeTmpDir('c5-gh-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    await installFoldPipeline('github', { cwd: cloneDir });

    const installed = fs.readFileSync(path.join(workflowsDir, 'fold-squad-state.yml'), 'utf-8');
    // M5: no-callsign output must be byte-for-byte identical to the raw template.
    const templatePath = path.join(TEMPLATES_ROOT, 'github', 'fold-squad-state.yml');
    expect(installed).toBe(fs.readFileSync(templatePath, 'utf-8'));
  });

  it('C6: no --callsign → ado template is byte-identical to raw template file', async () => {
    const docsRepoDir = makeTmpDir('c6-ado-noarg');
    const cloneDir = makeTmpDir('c6-ado-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir });
    } finally {
      consoleSpy.mockRestore();
    }

    const installed = fs.readFileSync(path.join(pipelinesDir, 'fold-squad-state.yml'), 'utf-8');
    // M5: no-callsign output must be byte-for-byte identical to the raw template.
    const templatePath = path.join(TEMPLATES_ROOT, 'ado', 'fold-squad-state.yml');
    expect(installed).toBe(fs.readFileSync(templatePath, 'utf-8'));
  });

  it('C8: callsign set → generated YAML has no bare squad-state token and no global inbox glob (both platforms)', async () => {
    // GitHub
    const ghDocsDir = makeTmpDir('c8-gh-docs');
    const ghCloneDir = makeTmpDir('c8-gh-clone');
    const ghCloneRoot = initGitRepo(ghCloneDir);
    const workflowsDir = path.join(ghDocsDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
    setupFoldRegistry(ghDocsDir, ghCloneRoot);
    await installFoldPipeline('github', { cwd: ghCloneDir, callsign: 'team-b' });
    const ghContent = fs.readFileSync(path.join(workflowsDir, 'fold-squad-state.yml'), 'utf-8');
    // No bare squad-state token anywhere (covers M4 orphan branch and all refs/names).
    expect(ghContent).not.toContain('squad-state');
    // No global inbox glob.
    expect(ghContent).not.toContain("'squad/inbox/**'");
    // Scoped mode pins the callsign and state branch without runtime discovery.
    expect(ghContent).toContain('callsigns="team-b"');
    expect(ghContent).toContain('STATE_BRANCH="squad/state/team-b"');

    // ADO
    const adoDocsDir = makeTmpDir('c8-ado-docs');
    const adoCloneDir = makeTmpDir('c8-ado-clone');
    const adoCloneRoot = initGitRepo(adoCloneDir);
    const pipelinesDir = path.join(adoDocsDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });
    setupFoldRegistry(adoDocsDir, adoCloneRoot);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: adoCloneDir, callsign: 'team-b' });
    } finally {
      consoleSpy.mockRestore();
    }
    const adoContent = fs.readFileSync(path.join(pipelinesDir, 'fold-squad-state.yml'), 'utf-8');
    expect(adoContent).not.toContain('squad-state');
    expect(adoContent).not.toContain('refs/heads/squad/inbox/*\n');
    // Scoped mode pins the callsign and state branch without runtime discovery.
    expect(adoContent).toContain('callsigns="team-b"');
    expect(adoContent).toContain('STATE_BRANCH="squad/state/team-b"');
  });

  it('C7: invalid --callsign exits 1 before writing any file', async () => {
    const docsRepoDir = makeTmpDir('c7-invalid-callsign');
    const cloneDir = makeTmpDir('c7-clone');
    const cloneRoot = initGitRepo(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupFoldRegistry(docsRepoDir, cloneRoot);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        installFoldPipeline('github', { cwd: cloneDir, callsign: 'INVALID-UPPER' }),
      ).rejects.toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errSpy.mock.calls.map(a => a.join(' ')).join('\n')).toContain('Invalid --callsign');
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }

    // No file must have been written
    expect(fs.existsSync(path.join(workflowsDir, 'fold-squad-state.yml'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sub-proposal D — Origin-ambiguity guard verification (assign.ts:530-544)
// ═══════════════════════════════════════════════════════════════════════════

describe('D — Origin-ambiguity guard behaviors (assign.ts)', { timeout: 30_000 }, () => {
  it('D1: 2-squad same remote → warning emitted, assignment SUCCEEDS (exit 0)', async () => {
    const base = makeTmpDir('d1-two-squad');
    const hostDirA = path.join(base, 'host-a');
    const hostDirB = path.join(base, 'host-b');
    const cloneDir = path.join(base, 'product-new');
    fs.mkdirSync(cloneDir, { recursive: true });

    const squadDirA = makeSquadHost(hostDirA, 'alpha');
    const squadDirB = makeSquadHost(hostDirB, 'beta');
    const registryPath = path.join(base, 'registry.json');
    const dir = path.dirname(registryPath);
    fs.mkdirSync(dir, { recursive: true });
    writeRegistryDirect(registryPath, {
      version: 1,
      squads: [
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared-remote.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared-remote.git'] },
      ],
    });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared-remote.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared-remote.git'] },
      ]),
      warnings: [],
    });

    const result = await runAssign(baseAssignOpts({
      callsignOrUrl: 'beta',
      registryPath,
      cwd: cloneDir,
      getGitRoot: () => cloneDir,
      // return the shared remote URL for the product clone
      getRemoteUrls: () => ['https://example.com/shared-remote.git'],
      _installCrossRepoHookFn: () => {},
    }));

    expect(result.kind).toBe('assigned');
    if (result.kind === 'assigned' || result.kind === 'reactivated') {
      const hasWarning = result.warnings.some(w =>
        w.toLowerCase().includes('origin') || w.toLowerCase().includes('warning')
      );
      expect(hasWarning).toBe(true);
    }
  });

  it('D2: 3-squad same remote without --callsign → ERR_ASSIGN_ORIGIN_AMBIGUITY', async () => {
    const base = makeTmpDir('d2-three-squad-ambiguous');
    const hostDirA = path.join(base, 'host-a');
    const hostDirB = path.join(base, 'host-b');
    const hostDirC = path.join(base, 'host-c');
    const cloneDir = path.join(base, 'product-new');
    fs.mkdirSync(cloneDir, { recursive: true });

    const squadDirA = makeSquadHost(hostDirA, 'alpha');
    const squadDirB = makeSquadHost(hostDirB, 'beta');
    const squadDirC = makeSquadHost(hostDirC, 'gamma');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistryDirect(registryPath, {
      version: 1,
      squads: [
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared.git'] },
        { callsign: 'gamma', path: squadDirC, origins: ['https://example.com/shared.git'] },
      ],
    });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared.git'] },
        { callsign: 'gamma', path: squadDirC, origins: ['https://example.com/shared.git'] },
      ]),
      warnings: [],
    });

    await expect(runAssign(baseAssignOpts({
      callsignOrUrl: 'gamma',
      registryPath,
      cwd: cloneDir,
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => ['https://example.com/shared.git'],
      _installCrossRepoHookFn: () => {},
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'ERR_ASSIGN_ORIGIN_AMBIGUITY',
    );
  });

  it('D3: 3-squad same remote WITH --callsign → ambiguous entries excluded, assignment SUCCEEDS', async () => {
    const base = makeTmpDir('d3-three-squad-with-callsign');
    const hostDirA = path.join(base, 'host-a');
    const hostDirB = path.join(base, 'host-b');
    const hostDirC = path.join(base, 'host-c');
    const cloneDir = path.join(base, 'product-new');
    fs.mkdirSync(cloneDir, { recursive: true });

    const squadDirA = makeSquadHost(hostDirA, 'alpha');
    const squadDirB = makeSquadHost(hostDirB, 'beta');
    const squadDirC = makeSquadHost(hostDirC, 'gamma');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    writeRegistryDirect(registryPath, {
      version: 1,
      squads: [
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared.git'] },
        { callsign: 'gamma', path: squadDirC, origins: ['https://example.com/shared.git'] },
      ],
    });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([
        { callsign: 'alpha', path: squadDirA, origins: ['https://example.com/shared.git'] },
        { callsign: 'beta', path: squadDirB, origins: ['https://example.com/shared.git'] },
        { callsign: 'gamma', path: squadDirC, origins: ['https://example.com/shared.git'] },
      ]),
      warnings: [],
    });

    // With --callsign gamma, the filter at assign.ts:535 excludes entries where callsign !== 'gamma'.
    // originMatchingEntries drops alpha and beta, leaving 0 matching → no ambiguity error.
    const result = await runAssign(baseAssignOpts({
      callsignOrUrl: 'gamma',
      callsign: 'gamma',
      registryPath,
      cwd: cloneDir,
      getGitRoot: () => cloneDir,
      getRemoteUrls: () => ['https://example.com/shared.git'],
      _installCrossRepoHookFn: () => {},
    }));

    expect(result.kind).toBe('assigned');
  });

  it('D4: Guard 7 — second assign of same product clone path to different squad FAILS', async () => {
    const base = makeTmpDir('d4-guard7');
    const hostDirA = path.join(base, 'host-a');
    const hostDirB = path.join(base, 'host-b');
    const sharedClone = path.join(base, 'shared-product');
    fs.mkdirSync(sharedClone, { recursive: true });

    const squadDirA = makeSquadHost(hostDirA, 'alpha');
    const squadDirB = makeSquadHost(hostDirB, 'beta');
    const registryPath = path.join(base, 'registry.json');
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    // alpha already has sharedClone in its clones[]
    writeRegistryDirect(registryPath, {
      version: 1,
      squads: [
        { callsign: 'alpha', path: squadDirA, clones: [sharedClone] },
        { callsign: 'beta', path: squadDirB },
      ],
    });

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([
        { callsign: 'alpha', path: squadDirA, clones: [sharedClone] },
        { callsign: 'beta', path: squadDirB },
      ]),
      warnings: [],
    });

    // Assigning sharedClone to beta must fail with ERR_ASSIGN_CROSS_CALLSIGN (Guard 7)
    await expect(runAssign(baseAssignOpts({
      callsignOrUrl: 'beta',
      registryPath,
      cwd: sharedClone,
      getGitRoot: () => sharedClone,
      getRemoteUrls: () => [],
      _installCrossRepoHookFn: () => {},
    }))).rejects.toSatisfy((err: unknown) =>
      err instanceof AssignError && err.code === 'ERR_ASSIGN_CROSS_CALLSIGN',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Two-squad integration scenario
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration — two squads, one remote, independent transport', { timeout: 120_000 }, () => {
  it('INT1: each squad publishes to its own squad/inbox/<callsign>/... and pulls its own squad/state/<callsign>', async () => {
    const base = makeTmpDir('int1-two-squads');

    // Shared bare remote (represents the shared origin)
    const sharedRemote = path.join(base, 'shared.git');
    initBareRepo(sharedRemote);

    // Squad A: team-a callsign, host clone A, product clone A
    const hostA = path.join(base, 'host-a');
    initWorkingRepo(hostA, 'origin', sharedRemote);
    setupSquadDir(hostA);

    const productA = path.join(base, 'product-a');
    initWorkingRepo(productA, 'origin', sharedRemote);

    // Squad B: team-b callsign, host clone B, product clone B
    const hostB = path.join(base, 'host-b');
    initWorkingRepo(hostB, 'origin', sharedRemote);
    setupSquadDir(hostB);
    // Give hostB different squad decisions so we can tell them apart
    fs.writeFileSync(path.join(hostB, '.squad', 'decisions.md'), '# team-b Decisions\n');

    const productB = path.join(base, 'product-b');
    initWorkingRepo(productB, 'origin', sharedRemote);

    // Publish from Squad A
    await publishTeamRootToInbox(hostA, 'origin', 'dev1', 'sess-team-a', 'team-a');

    // Publish from Squad B
    await publishTeamRootToInbox(hostB, 'origin', 'dev2', 'sess-team-b', 'team-b');

    const refs = listBareRefs(sharedRemote);

    // Squad A refs must be under team-a namespace
    const refsA = refs.filter(r => r.includes('/squad/inbox/team-a/'));
    const refsB = refs.filter(r => r.includes('/squad/inbox/team-b/'));
    expect(refsA).toHaveLength(1);
    expect(refsB).toHaveLength(1);

    // They must not overlap
    expect(refsA[0]).not.toBe(refsB[0]);

    // M6: cross-contamination negative assertions — squad A's refs must contain no team-b, vice versa.
    expect(refsA.some(r => r.includes('team-b'))).toBe(false);
    expect(refsB.some(r => r.includes('team-a'))).toBe(false);

    // The callsign in metadata must match each squad
    const metaA = JSON.parse(showBareFile(sharedRemote, `${refsA[0]}:.squad/publish-metadata.json`));
    const metaB = JSON.parse(showBareFile(sharedRemote, `${refsB[0]}:.squad/publish-metadata.json`));
    expect(metaA.callsign).toBe('team-a');
    expect(metaB.callsign).toBe('team-b');

    // Verify stateBranch would be namespaced when each squad uses squad/state/<callsign>
    // (pull side: runSync reads stateBranch from registry and passes to hydrateTeamRootFromStateRef)
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    // Mock registry for Squad A pull
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'team-a',
        path: path.join(hostA, '.squad'),
        clones: [productA],
        stateRemote: 'origin',
        stateBranch: 'squad/state/team-a',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });

    await runSync({ direction: 'pull', cwd: productA, quiet: true });
    expect(hydrateSpy).toHaveBeenCalledWith(
      expect.any(String), 'origin', 'squad/state/team-a',
    );
    hydrateSpy.mockClear();

    // Mock registry for Squad B pull
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'team-b',
        path: path.join(hostB, '.squad'),
        clones: [productB],
        stateRemote: 'origin',
        stateBranch: 'squad/state/team-b',
        inboxHandle: 'dev2',
      }]),
      warnings: [],
    });

    await runSync({ direction: 'pull', cwd: productB, quiet: true });
    expect(hydrateSpy).toHaveBeenCalledWith(
      expect.any(String), 'origin', 'squad/state/team-b',
    );

    hydrateSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIDO Edge Tests — adversarial inputs and round-trip verification
// ═══════════════════════════════════════════════════════════════════════════

describe('FIDO Edge Tests — adversarial callsign inputs and round-trip', { timeout: 60_000 }, () => {
  /** Minimal git repo without a remote (for cwd-only usage). */
  function makeMinimalGitRoot(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
    execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }

  /** Mock registry wired for installFoldPipeline (docs-repo path derived from entry.path dirname). */
  function setupFoldRegistryLocal(docsRepoDir: string, cloneRoot: string, callsign: string): void {
    makeMinimalGitRoot(docsRepoDir);
    const squadDir = path.join(docsRepoDir, '.squad');
    fs.mkdirSync(squadDir, { recursive: true });
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign,
        path: squadDir,
        clones: [cloneRoot],
        stateRemote: 'origin',
        stateBranch: `squad/state/${callsign}`,
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });
  }

  it('FIDO-E1: publishTeamRootToInbox rejects slash-containing, digit-starting, and single-char callsigns', async () => {
    const base = makeTmpDir('fido-e1-publish-invalid');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');
    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // These are distinct from A3 (which tests UPPERCASE, leading-dash, 40-char).
    const additionalInvalid = ['team/b', '1squad', 'a'];
    for (const cs of additionalInvalid) {
      await expect(
        publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-e1', cs),
      ).rejects.toThrow(/Invalid callsign/);
    }

    // No inbox branch must have been created for any of the above
    expect(listBareRefs(bare).filter(r => r.includes('/squad/inbox/'))).toHaveLength(0);
  });

  it('FIDO-E2: installFoldPipeline rejects slash-containing and digit-starting callsigns, writes no file', async () => {
    const docsRepoDir = makeTmpDir('fido-e2-ifp-invalid');
    const cloneDir = makeTmpDir('fido-e2-clone');
    const cloneRoot = makeMinimalGitRoot(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    // callsign 'dev1' is used only to satisfy registry lookup; the invalid callsigns
    // come from the --callsign flag and are rejected before any registry lookup completes.
    setupFoldRegistryLocal(docsRepoDir, cloneRoot, 'dev1');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null) => {
      throw new Error('process.exit called');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Distinct from C7 which only tested uppercase. Slash and digit-start hit
      // the same guard but via different RE failure modes.
      for (const cs of ['team/b', '2squad', 'z']) {
        await expect(
          installFoldPipeline('github', { cwd: cloneDir, callsign: cs }),
        ).rejects.toThrow('process.exit called');
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockClear();
      }
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }

    // Guard must fire before any file is written
    expect(fs.existsSync(path.join(workflowsDir, 'fold-squad-state.yml'))).toBe(false);
  });

  it('FIDO-E3: --platform github --callsign team-b injects correctly into both trigger and target', async () => {
    const docsRepoDir = makeTmpDir('fido-e3-gh-both');
    const cloneDir = makeTmpDir('fido-e3-clone');
    const cloneRoot = makeMinimalGitRoot(cloneDir);
    const workflowsDir = path.join(docsRepoDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });

    setupFoldRegistryLocal(docsRepoDir, cloneRoot, 'team-b');

    await installFoldPipeline('github', { cwd: cloneDir, callsign: 'team-b' });

    const content = fs.readFileSync(path.join(workflowsDir, 'fold-squad-state.yml'), 'utf-8');
    // Both the trigger glob and the fold target must carry the full namespaced callsign
    expect(content).toContain('squad/inbox/team-b/**');
    expect(content).toContain('squad/state/team-b');
    // Global (non-namespaced) patterns must not be present
    expect(content).not.toContain("'squad/inbox/**'");
    expect(content).not.toContain('HEAD:refs/heads/squad-state');
  });

  it('FIDO-E4: --platform ado --callsign team-b injects correctly into both trigger and target', async () => {
    const docsRepoDir = makeTmpDir('fido-e4-ado-both');
    const cloneDir = makeTmpDir('fido-e4-clone');
    const cloneRoot = makeMinimalGitRoot(cloneDir);
    const pipelinesDir = path.join(docsRepoDir, '.azuredevops');
    fs.mkdirSync(pipelinesDir, { recursive: true });

    setupFoldRegistryLocal(docsRepoDir, cloneRoot, 'team-b');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installFoldPipeline('ado', { cwd: cloneDir, callsign: 'team-b' });
    } finally {
      consoleSpy.mockRestore();
    }

    const content = fs.readFileSync(path.join(pipelinesDir, 'fold-squad-state.yml'), 'utf-8');
    expect(content).toContain('refs/heads/squad/inbox/team-b/*');
    expect(content).toContain('squad/state/team-b');
    expect(content).not.toContain('- refs/heads/squad/inbox/*\n');
    expect(content).not.toContain('HEAD:refs/heads/squad-state');
  });

  it('FIDO-E5: publish-metadata.json callsign field round-trips exactly for hyphenated callsign', async () => {
    const base = makeTmpDir('fido-e5-roundtrip');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'teamroot');
    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-e5', 'team-b');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/team-b/dev1/'));
    expect(inboxRef).toBeTruthy();

    const rawMeta = showBareFile(bare, `${inboxRef}:.squad/publish-metadata.json`);
    const meta = JSON.parse(rawMeta);
    // The stored callsign must be byte-for-byte equal to the input — no normalisation
    expect(meta.callsign).toBe('team-b');
    expect(typeof meta.callsign).toBe('string');
  });
});
