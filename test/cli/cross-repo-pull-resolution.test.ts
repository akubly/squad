/**
 * Piece 43 — Cross-repo `sync --pull` state remote and branch resolution.
 *
 * Covers:
 *  - A: the state remote is resolved from the registry/team-root host, not the code clone.
 *  - B: when an entry has no explicit stateBranch but carries a callsign, the pull derives
 *       squad/state/<callsign> (reusing CALLSIGN_RE), not the flat legacy branch.
 *  - C: a cross-repo pull does not run the in-clone fetch against the code clone
 *       (no misleading "no remote squad-state refs" notice); single-repo pull is unchanged.
 *  - D: D1 fallback — an entry with neither stateBranch nor callsign retains the flat
 *       legacy `squad-state` branch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Registry } from '@bradygaster/squad-sdk/registry';

vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));

import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import { runSync, _transport } from '../../packages/squad-cli/src/cli/commands/sync.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.pull-resolution-tmp');
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

/** Configure the current branch's default remote so resolveRemote() returns it. */
function setBranchRemote(repo: string, remoteName: string): void {
  const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: repo, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  execFileSync('git', ['config', `branch.${branch}.remote`, remoteName], { cwd: repo, stdio: 'pipe' });
}

function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_INBOX_HANDLE'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

/** Set up a host team-root + code clone, mock the registry entry, return the work repo path. */
function setupCrossRepo(base: string, entryExtra: Partial<Registry['squads'][number]>, opts?: {
  teamRootRemoteName?: string;
}): { workRepo: string; teamRoot: string; teamRemote: string } {
  const teamRemote = path.join(base, 'state-remote.git');
  const teamRoot = path.join(base, 'docs');
  const workRepo = path.join(base, 'work');
  const codeRemote = path.join(base, 'code-remote.git');

  initBareRepo(teamRemote);
  initBareRepo(codeRemote);
  const remoteName = opts?.teamRootRemoteName ?? 'origin';
  initWorkingRepo(teamRoot, remoteName, teamRemote);
  if (remoteName !== 'origin') setBranchRemote(teamRoot, remoteName);
  setupSquadDir(teamRoot);
  const workGitRoot = initWorkingRepo(workRepo, 'origin', codeRemote);

  vi.mocked(loadRegistryFromDisk).mockReturnValue({
    registry: makeRegistry([{
      path: path.join(teamRoot, '.squad'),
      clones: [workGitRoot],
      ...entryExtra,
    }]),
    warnings: [],
  });

  return { workRepo, teamRoot, teamRemote };
}

// ─── A: state remote resolved from the team-root host ────────────────────────

describe('piece 43 — A: state remote resolution', { timeout: 60_000 }, () => {
  it('A1: explicit entry.stateRemote is used verbatim for hydration', async () => {
    const base = makeTmpDir('A1');
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateRemote: 'origin', stateBranch: 'squad-state' });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'origin', 'squad-state');
  });

  it('A2: with no entry.stateRemote, the remote resolves from the team-root host, not a literal origin or the code clone', async () => {
    const base = makeTmpDir('A2');
    // team-root host's default remote is named "state-host"; the code clone's is "origin".
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateBranch: 'squad-state' }, { teamRootRemoteName: 'state-host' });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'state-host', 'squad-state');
  });
});

// ─── B: callsign → state-branch derivation ───────────────────────────────────

describe('piece 43 — B: state branch derivation', { timeout: 60_000 }, () => {
  it('B1: no stateBranch + callsign → derives squad/state/<callsign>', async () => {
    const base = makeTmpDir('B1');
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateRemote: 'origin', callsign: 'acme' });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'origin', 'squad/state/acme');
  });

  it('B2: explicit stateBranch wins over callsign derivation', async () => {
    const base = makeTmpDir('B2');
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateRemote: 'origin', callsign: 'acme', stateBranch: 'custom/state-branch' });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'origin', 'custom/state-branch');
  });

  it('B3: derived branch is byte-identical to the assign/init namespaced value', async () => {
    const base = makeTmpDir('B3');
    const callsign = 'beta-squad';
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateRemote: 'origin', callsign });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    // assign.ts / init.ts persist `squad/state/${callsign}` — derivation must match exactly.
    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'origin', `squad/state/${callsign}`);
  });
});

// ─── C: cross-repo pull skips the in-clone fetch ─────────────────────────────

describe('piece 43 — C: cross-repo pull skips the in-clone fetch', { timeout: 60_000 }, () => {
  it('C1: a cross-repo pull does not emit the "no remote squad-state refs" notice', async () => {
    const base = makeTmpDir('C1');
    const { workRepo } = setupCrossRepo(base, { stateRemote: 'origin', stateBranch: 'squad-state' });
    vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSync({ direction: 'pull', cwd: workRepo, quiet: false });

    const logged = logSpy.mock.calls.map(a => String(a[0])).join('\n');
    expect(logged).not.toContain('No remote squad-state refs found');
  });

  it('C2: a single-repo pull still runs the in-clone fetch (regression guard)', async () => {
    const base = makeTmpDir('C2');
    const workRemote = path.join(base, 'work-remote.git');
    const workRepo = path.join(base, 'work');
    initBareRepo(workRemote);
    initWorkingRepo(workRepo, 'origin', workRemote);
    fs.mkdirSync(path.join(workRepo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(workRepo, '.squad', 'config.json'), JSON.stringify({ stateBackend: 'orphan' }));
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSync({ direction: 'pull', cwd: workRepo, quiet: false });

    const logged = logSpy.mock.calls.map(a => String(a[0])).join('\n');
    expect(logged).toContain('No remote squad-state refs found');
  });
});

// ─── A (push): publish destination resolves from the team-root host ──────────

describe('piece 43 — A (push): publish destination resolution', { timeout: 60_000 }, () => {
  it('A3: with no entry.stateRemote, push publishes to the team-root host remote, not a literal origin', async () => {
    const base = makeTmpDir('A3');
    const { workRepo, teamRoot } = setupCrossRepo(
      base,
      { callsign: 'acme' },
      { teamRootRemoteName: 'state-host' },
    );
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);

    await runSync({ direction: 'push', cwd: workRepo, quiet: true, inboxHandle: 'dev1' });

    expect(publishSpy).toHaveBeenCalledWith(teamRoot, 'state-host', 'dev1', expect.any(String), 'acme');
  });

  it('A4: explicit entry.stateRemote wins for the publish destination', async () => {
    const base = makeTmpDir('A4');
    const { workRepo, teamRoot } = setupCrossRepo(
      base,
      { callsign: 'acme', stateRemote: 'upstream' },
      { teamRootRemoteName: 'state-host' },
    );
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);

    await runSync({ direction: 'push', cwd: workRepo, quiet: true, inboxHandle: 'dev1' });

    expect(publishSpy).toHaveBeenCalledWith(teamRoot, 'upstream', 'dev1', expect.any(String), 'acme');
  });
});

// ─── D: fallback decision (D1 — retain flat legacy branch) ────────────────────

describe('piece 43 — D1: legacy fallback when neither stateBranch nor callsign', { timeout: 60_000 }, () => {
  it('D1: entry with neither stateBranch nor callsign hydrates from the flat squad-state branch', async () => {
    const base = makeTmpDir('D1');
    const { workRepo, teamRoot } = setupCrossRepo(base, { stateRemote: 'origin' });
    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef').mockResolvedValue(undefined);

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    expect(hydrateSpy).toHaveBeenCalledWith(teamRoot, 'origin', 'squad-state');
  });
});
