/**
 * Unit tests for registry-based resolution in runSync.
 *
 * Covers sub-proposals A (TEAM_ROOT / registry resolution) and D (alias chain).
 * Transport integration tests (B/C dispatch) live in cross-repo-sync.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Registry } from '@bradygaster/squad-sdk/registry';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));

import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { runSync } from '../../packages/squad-cli/src/cli/commands/sync.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.sync-resolution-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

/** Initialize a working git repo and return its normalized git root. */
function initWorkingRepo(dir: string, remoteName?: string, remoteUrl?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  if (remoteName && remoteUrl) {
    execFileSync('git', ['remote', 'add', remoteName, remoteUrl], { cwd: dir, stdio: 'pipe' });
  }
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function initBareRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', dir], { stdio: 'pipe' });
}

function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad', 'decisions', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
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

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
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
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ─── Helper: spy on process.exit ─────────────────────────────────────────────

function mockProcessExit(): { spy: ReturnType<typeof vi.spyOn>; calls: number[] } {
  const calls: number[] = [];
  const spy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
    calls.push(typeof code === 'number' ? code : 1);
    throw new Error(`process.exit(${code})`);
  });
  return { spy, calls };
}

// ─── Sub-proposal A: Registry resolution ─────────────────────────────────────

describe('TEAM_ROOT / registry resolution (sub-proposal A)', { timeout: 60_000 }, () => {

  it('A1: registry match → teamRoot = path.dirname(entry.path), no exit-1', async () => {
    const base = makeTmpDir('A1');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    const gitRoot = initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        inboxHandle: 'dev1',
      }]),
      warnings: [],
    });

    const { spy } = mockProcessExit();
    // publishTeamRootToInbox will run with docsTeamRoot as teamRoot — must succeed
    await runSync({ direction: 'push', cwd: workRepo, developer: 'dev1', quiet: true });
    expect(spy).not.toHaveBeenCalledWith(1);
    spy.mockRestore();
    void gitRoot; // used to confirm gitRoot is a valid path
  });

  it('A2: stateRemote / stateBranch / inboxHandle pulled from same entry as teamRoot', async () => {
    const base = makeTmpDir('A2');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxHandle: 'alice',
      }]),
      warnings: [],
    });

    // Push using registry alias (no --developer flag)
    await runSync({ direction: 'push', cwd: workRepo, quiet: true });

    // Inbox ref uses the registry alias 'alice'
    const refs = listBareRefs(docsRemote);
    expect(refs.some(r => r.includes('squad/inbox/alice/'))).toBe(true);
  });

  it('A3: SQUAD_TEAM_ROOT env overrides registry lookup — loadRegistryFromDisk NOT called', async () => {
    const base = makeTmpDir('A3');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'squad-docs', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);

    process.env['SQUAD_TEAM_ROOT'] = docsTeamRoot;
    // Registry would return no entry, but SQUAD_TEAM_ROOT bypasses registry lookup
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    await runSync({ direction: 'push', cwd: workRepo, developer: 'dev1', quiet: true });

    // loadRegistryFromDisk should NOT have been called (env override short-circuits it)
    expect(vi.mocked(loadRegistryFromDisk)).not.toHaveBeenCalled();
    // Inbox ref should be created using docsTeamRoot
    const refs = listBareRefs(docsRemote);
    expect(refs.some(r => r.includes('squad/inbox/dev1/'))).toBe(true);
  });

  it('A4: no registry match + no config.json + push → exits 1 referencing squad assign', async () => {
    const base = makeTmpDir('A4');
    const workRepo = path.join(base, 'work');
    initWorkingRepo(workRepo);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
    // No config.json in workRepo

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { spy, calls } = mockProcessExit();
    let threw = false;
    try {
      await runSync({ direction: 'push', cwd: workRepo, developer: 'dev1', quiet: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(calls).toContain(1);
    // G3: exit message must reference 'squad assign'
    const errorMsg = errorSpy.mock.calls.map(args => String(args[0])).join('\n');
    expect(errorMsg).toContain('squad assign');
    errorSpy.mockRestore();
    spy.mockRestore();
  });

  it('A5: two registry entries → only matching clone entry is used', async () => {
    const base = makeTmpDir('A5');
    const correctRemote = path.join(base, 'correct-remote.git');
    const wrongRemote = path.join(base, 'wrong-remote.git');
    const correctDocs = path.join(base, 'correct-docs');
    const wrongDocs = path.join(base, 'wrong-docs');
    const workRepo = path.join(base, 'work');
    const otherRepo = path.join(base, 'other');

    initBareRepo(correctRemote);
    initBareRepo(wrongRemote);
    initWorkingRepo(correctDocs, 'origin', correctRemote);
    initWorkingRepo(wrongDocs, 'origin', wrongRemote);
    setupSquadDir(correctDocs);
    setupSquadDir(wrongDocs);

    const workGitRoot = initWorkingRepo(workRepo);
    const otherRoot = initWorkingRepo(otherRepo);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([
        { path: path.join(wrongDocs, '.squad'), clones: [otherRoot], stateRemote: 'origin', inboxHandle: 'wrong-dev' },
        { path: path.join(correctDocs, '.squad'), clones: [workGitRoot], stateRemote: 'origin', inboxHandle: 'correct-dev' },
      ]),
      warnings: [],
    });

    await runSync({ direction: 'push', cwd: workRepo, quiet: true });

    // Inbox ref should appear on correctRemote (under 'correct-dev'), NOT on wrongRemote
    const correctRefs = listBareRefs(correctRemote);
    const wrongRefs = listBareRefs(wrongRemote);
    expect(correctRefs.some(r => r.includes('squad/inbox/correct-dev/'))).toBe(true);
    expect(wrongRefs.filter(r => r.includes('squad/inbox/'))).toHaveLength(0);
  });

  it('A6: single-repo (config.json present, no registry entry) → no exit-1, syncPull path taken', async () => {
    const base = makeTmpDir('A6');
    const workRepo = path.join(base, 'work');
    initWorkingRepo(workRepo);

    // Write .squad/config.json
    fs.mkdirSync(path.join(workRepo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(workRepo, '.squad', 'config.json'), JSON.stringify({ stateBackend: 'orphan' }));

    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const { spy } = mockProcessExit();
    try {
      // direction: 'pull' — single-repo pull should work without alias
      await runSync({ direction: 'pull', cwd: workRepo, quiet: true });
    } catch {
      // syncPull may fail (no remote) — not relevant
    }
    expect(spy).not.toHaveBeenCalledWith(1);
    spy.mockRestore();
  });

  it('A7: no-match + no config.json → pull direction does NOT exit-1 (push-only check)', async () => {
    const base = makeTmpDir('A7');
    const workRepo = path.join(base, 'work');
    initWorkingRepo(workRepo);

    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const { spy } = mockProcessExit();
    try {
      await runSync({ direction: 'pull', cwd: workRepo, quiet: true });
    } catch {
      // syncPull may fail
    }
    expect(spy).not.toHaveBeenCalledWith(1);
    spy.mockRestore();
  });
});

// ─── Sub-proposal D: Alias chain ─────────────────────────────────────────────

describe('Alias resolution chain (sub-proposal D)', { timeout: 60_000 }, () => {

  /** Helper: set up a bare+teamRoot+workRepo and mock registry, then run push. */
  async function pushAndGetRefs(base: string, opts: {
    developer?: string;
    envAlias?: string;
    registryAlias?: string;
  }): Promise<string[]> {
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    if (opts.envAlias) process.env['SQUAD_INBOX_HANDLE'] = opts.envAlias;

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        ...(opts.registryAlias ? { inboxHandle: opts.registryAlias } : {}),
      }]),
      warnings: [],
    });

    await runSync({ direction: 'push', cwd: workRepo, developer: opts.developer, quiet: true });

    return listBareRefs(docsRemote);
  }

  it('D1: --developer flag wins over SQUAD_INBOX_HANDLE env and registry alias', async () => {
    const base = makeTmpDir('D1');
    const refs = await pushAndGetRefs(base, {
      developer: 'flag-alias',
      envAlias: 'env-alias',
      registryAlias: 'registry-alias',
    });
    expect(refs.some(r => r.includes('squad/inbox/flag-alias/'))).toBe(true);
    expect(refs.some(r => r.includes('squad/inbox/env-alias/'))).toBe(false);
    expect(refs.some(r => r.includes('squad/inbox/registry-alias/'))).toBe(false);
  });

  it('D2: SQUAD_INBOX_HANDLE env wins when --developer flag absent', async () => {
    const base = makeTmpDir('D2');
    const refs = await pushAndGetRefs(base, {
      envAlias: 'env-alias',
      registryAlias: 'registry-alias',
    });
    expect(refs.some(r => r.includes('squad/inbox/env-alias/'))).toBe(true);
    expect(refs.some(r => r.includes('squad/inbox/registry-alias/'))).toBe(false);
  });

  it('D3: registry inboxHandle wins when neither --developer nor SQUAD_INBOX_HANDLE', async () => {
    const base = makeTmpDir('D3');
    const refs = await pushAndGetRefs(base, {
      registryAlias: 'registry-alias',
    });
    expect(refs.some(r => r.includes('squad/inbox/registry-alias/'))).toBe(true);
  });

  it('D4: missing alias on cross-repo push exits 1 referencing squad assign', async () => {
    const base = makeTmpDir('D4');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        // No inboxHandle
      }]),
      warnings: [],
    });
    // No --developer, no SQUAD_INBOX_HANDLE, no registry alias

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { spy, calls } = mockProcessExit();
    let threw = false;
    try {
      await runSync({ direction: 'push', cwd: workRepo, quiet: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(calls).toContain(1);
    // G3: exit message must reference 'squad assign --inbox-handle'
    const errorMsg = errorSpy.mock.calls.map(args => String(args[0])).join('\n');
    expect(errorMsg).toContain('squad assign --inbox-handle');
    errorSpy.mockRestore();
    spy.mockRestore();
  });

  it('D5: missing alias is allowed on pull (alias only required for push)', async () => {
    const base = makeTmpDir('D5');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        // No inboxHandle — pull should still work
      }]),
      warnings: [],
    });

    const { spy } = mockProcessExit();
    try {
      await runSync({ direction: 'pull', cwd: workRepo, quiet: true });
    } catch {
      // syncPull may fail, hydrateTeamRootFromStateRef may fail — not relevant
    }
    expect(spy).not.toHaveBeenCalledWith(1);
    spy.mockRestore();
  });

  it('D6: whitespace-only alias on --push is trimmed to empty → exits 1 referencing squad assign --inbox-handle', async () => {
    const base = makeTmpDir('D6');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        // No inboxHandle in registry either
      }]),
      warnings: [],
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { spy, calls } = mockProcessExit();
    let threw = false;
    try {
      // Pass whitespace-only developer value — should be trimmed to '' → treated as missing
      await runSync({ direction: 'push', cwd: workRepo, developer: '   ', quiet: true });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(calls).toContain(1);
    const errorMsg = errorSpy.mock.calls.map(args => String(args[0])).join('\n');
    expect(errorMsg).toContain('squad assign --inbox-handle');
    errorSpy.mockRestore();
    spy.mockRestore();
  });
});
