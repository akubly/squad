/**
 * Cross-repo state transport helpers — pieces 32.5 and 33
 *
 * Tests for publishTeamRootToInbox and hydrateTeamRootFromStateRef (direct).
 * Integration tests for runSync CLI dispatch wiring (B/C sub-proposals).
 */

// ─── Registry mock (used by runSync integration tests only) ──────────────────
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
  runSync,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import type { Registry } from '@bradygaster/squad-sdk/registry';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.cross-repo-sync-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

/** Initialize a bare git repo at `dir`. */
function initBareRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--bare', dir], { stdio: 'pipe' });
}

/** Initialize a working git repo at `dir`, commit an initial file, and wire `remote`. */
function initWorkingRepo(dir: string, remoteName: string, remoteUrl: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', remoteName, remoteUrl], { cwd: dir, stdio: 'pipe' });
}

/** Populate a minimal set of allowlisted .squad/ files in `teamRoot`. */
function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad', 'decisions', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions', 'inbox', 'item.md'), '# Item\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'log', 'session.md'), '# Log\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'sessions', 'session.json'), '{}');
}

/** List refs on a bare repo, returning e.g. ["refs/heads/squad/inbox/dev1/..."] */
function listBareRefs(bareDir: string): string[] {
  try {
    return execFileSync('git', ['--git-dir', bareDir, 'for-each-ref', '--format=%(refname)'], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Show a file from a commit on a bare repo. */
function showBareFile(bareDir: string, refAndPath: string): string {
  return execFileSync('git', ['--git-dir', bareDir, 'show', refAndPath], {
    encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  // Reset registry mock to null before each test (integration tests override per-test)
  vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  vi.clearAllMocks();
  delete process.env['SQUAD_TEAM_ROOT'];
  delete process.env['SQUAD_DEVELOPER_ALIAS'];
  delete process.env['SQUAD_SYNC_ACTIVE'];
  delete process.env['COPILOT_SESSION_ID'];
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('publishTeamRootToInbox', { timeout: 60_000 }, () => {
  it('1. two developers publish to the same bare remote — independent inbox refs, no conflict', async () => {
    const base = makeTmpDir('concurrent');
    const bare = path.join(base, 'bare.git');
    const repo1 = path.join(base, 'dev1-root');
    const repo2 = path.join(base, 'dev2-root');

    initBareRepo(bare);
    initWorkingRepo(repo1, 'origin', bare);
    initWorkingRepo(repo2, 'origin', bare);
    setupSquadDir(repo1);
    setupSquadDir(repo2);

    await publishTeamRootToInbox(repo1, 'origin', 'dev1', 'sess-aaa');
    await publishTeamRootToInbox(repo2, 'origin', 'dev2', 'sess-bbb');

    const refs = listBareRefs(bare);
    const dev1Refs = refs.filter(r => r.includes('/squad/inbox/dev1/'));
    const dev2Refs = refs.filter(r => r.includes('/squad/inbox/dev2/'));
    expect(dev1Refs).toHaveLength(1);
    expect(dev2Refs).toHaveLength(1);
    expect(dev1Refs[0]).not.toBe(dev2Refs[0]);
  });

  it('3. publish-metadata.json sourceWorkRoot is an object with repo (string) and pathHash (string starting "sha256:")', async () => {
    const base = makeTmpDir('metadata');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-meta');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/dev1/'));
    expect(inboxRef).toBeTruthy();

    const rawMeta = showBareFile(bare, `${inboxRef}:.squad/publish-metadata.json`);
    const meta = JSON.parse(rawMeta);

    expect(typeof meta.sourceWorkRoot).toBe('object');
    expect(meta.sourceWorkRoot).not.toBeNull();
    expect(typeof meta.sourceWorkRoot.repo).toBe('string');
    expect(meta.sourceWorkRoot.repo.length).toBeGreaterThan(0);
    expect(typeof meta.sourceWorkRoot.pathHash).toBe('string');
    expect(meta.sourceWorkRoot.pathHash.startsWith('sha256:')).toBe(true);
  });

  it('4. no string value in publish-metadata.json contains the raw absolute path or OS user-dir segments', async () => {
    const base = makeTmpDir('pii');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-pii');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/dev1/'));
    const rawMeta = showBareFile(bare, `${inboxRef}:.squad/publish-metadata.json`);
    const serialized = JSON.stringify(JSON.parse(rawMeta));

    // The normalized absolute path must not appear as a raw substring in any string field.
    // Only the hash may encode path information.
    const normalizedRepoPath = repo.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    expect(serialized.toLowerCase()).not.toContain(normalizedRepoPath);

    // OS user-dir segments must be absent too
    const forbidden = [/Users[/\\]/i, /\/home\//i, /[A-Za-z]:[/\\]/];
    for (const pattern of forbidden) {
      expect(pattern.test(serialized)).toBe(false);
    }

    // pathHash must still be present and correctly prefixed
    const meta = JSON.parse(rawMeta);
    expect(meta.sourceWorkRoot.pathHash.startsWith('sha256:')).toBe(true);
  });

  it('5. pathHash is identical across two invocations from the same work-tree', async () => {
    const base = makeTmpDir('pathhash');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-first');
    await publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-second');

    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/dev1/'));
    expect(inboxRefs).toHaveLength(2);

    const readHash = (ref: string) => {
      const raw = showBareFile(bare, `${ref}:.squad/publish-metadata.json`);
      return JSON.parse(raw).sourceWorkRoot.pathHash as string;
    };

    const hash1 = readHash(inboxRefs[0]);
    const hash2 = readHash(inboxRefs[1]);
    expect(hash1).toBe(hash2);
    expect(hash1.startsWith('sha256:')).toBe(true);
  });

  it('7. malformed developerAlias rejects before any ref is created on the remote', async () => {
    const base = makeTmpDir('alias-guard');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    const badAliases = ['', 'BAD', '-abc', 'a'.repeat(40)];
    for (const alias of badAliases) {
      await expect(publishTeamRootToInbox(repo, 'origin', alias, 'sess-x')).rejects.toThrow(
        /Invalid developerAlias/,
      );
    }

    // No refs should have been created on the bare remote
    const refs = listBareRefs(bare);
    expect(refs.filter(r => r.includes('/squad/inbox/'))).toHaveLength(0);
  });

  it('7b. [FIDO HIGH] malformed sessionId rejects before any ref is created on the remote', async () => {
    const base = makeTmpDir('sessionid-guard');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // Empty, contains whitespace, contains ~, contains .., contains @{, ends in .lock
    const badSessionIds = ['', 'has space', 'has~tilde', 'has..dots', 'has@{at', 'ends.lock'];
    for (const sid of badSessionIds) {
      await expect(publishTeamRootToInbox(repo, 'origin', 'dev1', sid)).rejects.toThrow(
        /Invalid sessionId/,
      );
    }

    const refs = listBareRefs(bare);
    expect(refs.filter(r => r.includes('/squad/inbox/'))).toHaveLength(0);
  });

  it('boundary: 39-char alias (max valid) is accepted; 40-char alias is rejected', async () => {
    const base = makeTmpDir('alias-boundary');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // a + 38 lowercase chars = 39 total — valid (regex: /^[a-z][a-z0-9-]{1,38}$/ = 2-39 chars)
    const validAlias = 'a' + 'b'.repeat(38);
    await expect(
      publishTeamRootToInbox(repo, 'origin', validAlias, 'sess-ok'),
    ).resolves.not.toThrow();

    // a + 39 lowercase chars = 40 total — invalid
    const tooLong = 'a' + 'b'.repeat(39);
    await expect(
      publishTeamRootToInbox(repo, 'origin', tooLong, 'sess-toolong'),
    ).rejects.toThrow(/Invalid developerAlias/);
  });

  it('8. non-allowlisted paths (.squad/config.json) are silently filtered — publish succeeds with allowlisted subset', async () => {
    const base = makeTmpDir('allowlist-filter');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // Plant a non-allowlisted file alongside the allowlisted ones
    fs.writeFileSync(path.join(repo, '.squad', 'config.json'), '{"stateBackend":"worktree"}');

    // Publish must succeed (no throw) even though config.json is not allowlisted
    await expect(publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-y')).resolves.not.toThrow();

    // An inbox ref must have been created
    const refs = listBareRefs(bare);
    const inboxRefs = refs.filter(r => r.includes('/squad/inbox/dev1/'));
    expect(inboxRefs).toHaveLength(1);

    // decisions.md (allowlisted) must be in the snapshot
    const metaRaw = showBareFile(bare, `${inboxRefs[0]}:.squad/decisions.md`);
    expect(metaRaw).toContain('# Decisions');

    // config.json (non-allowlisted) must NOT be in the snapshot tree
    expect(() => showBareFile(bare, `${inboxRefs[0]}:.squad/config.json`)).toThrow();
  });
});

describe('hydrateTeamRootFromStateRef', { timeout: 60_000 }, () => {
  it('2. round-trips a synthetic state commit into a fresh TEAM_ROOT working dir', async () => {
    const base = makeTmpDir('roundtrip');
    const bare = path.join(base, 'bare.git');
    const publishRepo = path.join(base, 'publisher');
    const hydrateRepo = path.join(base, 'hydrate');

    initBareRepo(bare);
    initWorkingRepo(publishRepo, 'origin', bare);
    setupSquadDir(publishRepo);

    await publishTeamRootToInbox(publishRepo, 'origin', 'tester', 'sess-rt');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/tester/'));
    expect(inboxRef).toBeTruthy();
    const stateBranch = inboxRef!.replace('refs/heads/', '');

    // Hydrate into a fresh working repo
    initWorkingRepo(hydrateRepo, 'origin', bare);
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);

    // decisions.md should now be present in hydrateRepo
    const decisionsPath = path.join(hydrateRepo, '.squad', 'decisions.md');
    expect(fs.existsSync(decisionsPath)).toBe(true);
    expect(fs.readFileSync(decisionsPath, 'utf-8')).toBe('# Decisions\n');
  });

  it('6. hydrateTeamRootFromStateRef is idempotent — second call when sentinel matches the fetched SHA is a true no-op (no fs writes)', async () => {
    const base = makeTmpDir('idempotent');
    const bare = path.join(base, 'bare.git');
    const publishRepo = path.join(base, 'publisher');
    const hydrateRepo = path.join(base, 'hydrate');

    initBareRepo(bare);
    initWorkingRepo(publishRepo, 'origin', bare);
    setupSquadDir(publishRepo);

    await publishTeamRootToInbox(publishRepo, 'origin', 'tester', 'sess-idem');

    const refs = listBareRefs(bare);
    const inboxRef = refs.find(r => r.includes('/squad/inbox/tester/'));
    const stateBranch = inboxRef!.replace('refs/heads/', '');

    initWorkingRepo(hydrateRepo, 'origin', bare);
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);

    // After the first hydration, .squad/.last-hydrate-sha sentinel is written.
    // A second call should read the sentinel, find it matches fetchedSha, and return early.
    const sentinelPath = path.join(hydrateRepo, '.squad', '.last-hydrate-sha');
    expect(fs.existsSync(sentinelPath)).toBe(true);

    // Spy on fs.writeFileSync to assert that no writes occur on the idempotent call.
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

// ─── runSync integration (piece 33 sub-proposals B & C) ──────────────────────
//
// These tests call runSync through the CLI dispatch interface — NOT the library
// helpers directly — to prove push/pull wiring is in place.

function makeRegistry(entries: Registry['squads']): Registry {
  return { version: 1, squads: entries };
}

describe('runSync — cross-repo CLI dispatch integration (B/C)', { timeout: 120_000 }, () => {
  it('B1: --push with matching registry entry creates squad/inbox/<alias>/<ts>-<sessionId> on bare remote', async () => {
    const base = makeTmpDir('B1-push');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);

    // workRepo is the product repo (its git root = clone in registry)
    initWorkingRepo(workRepo, 'origin', docsRemote);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    // Registry entry: path ends in .squad; clones contains workRepo git root
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        developerAlias: 'alice',
      }]),
      warnings: [],
    });

    process.env['COPILOT_SESSION_ID'] = 'test-session-b1';

    await runSync({ direction: 'push', cwd: workRepo, developer: 'alice', quiet: true });

    const refs = listBareRefs(docsRemote);
    const inboxRefs = refs.filter(r => r.includes('refs/heads/squad/inbox/alice/'));
    expect(inboxRefs).toHaveLength(1);
    expect(inboxRefs[0]).toContain('test-session-b1');
  });

  it('B2: --push with no registry entry falls back to syncPush — NO inbox ref (regression guard)', async () => {
    const base = makeTmpDir('B2-regression');
    const workRemote = path.join(base, 'work-remote.git');
    const workRepo = path.join(base, 'work');

    initBareRepo(workRemote);
    initWorkingRepo(workRepo, 'origin', workRemote);

    // Capture the default branch name before switching to squad-state
    const defaultBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    // Create squad-state branch so syncPush has something to push
    execFileSync('git', ['checkout', '--orphan', 'squad-state'], { cwd: workRepo, stdio: 'pipe' });
    execFileSync('git', ['rm', '-rf', '--cached', '.'], { cwd: workRepo, stdio: 'pipe' });
    // Remove any untracked files so the commit is clean
    try { fs.rmSync(path.join(workRepo, '.gitkeep')); } catch { /* may not exist */ }
    fs.writeFileSync(path.join(workRepo, 'state.json'), '{}');
    execFileSync('git', ['add', 'state.json'], { cwd: workRepo, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'state init'], { cwd: workRepo, stdio: 'pipe' });
    // Switch back to default branch; HEAD must not be squad-state for resolveRemote to fall back to origin
    execFileSync('git', ['checkout', '-f', defaultBranch], { cwd: workRepo, stdio: 'pipe' });

    // Write .squad/config.json so single-repo path is taken (no exit-1)
    fs.mkdirSync(path.join(workRepo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(workRepo, '.squad', 'config.json'), JSON.stringify({ stateBackend: 'orphan' }));

    // No registry entry
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    // G1: spy-based guard — publishTeamRootToInbox must NOT be called for single-repo push
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox');

    await runSync({ direction: 'push', cwd: workRepo, quiet: true });

    const refs = listBareRefs(workRemote);
    // squad-state branch should be pushed (normal syncPush)
    expect(refs.some(r => r.includes('squad-state'))).toBe(true);
    // No inbox ref — observable guard
    expect(refs.filter(r => r.includes('squad/inbox/'))).toHaveLength(0);
    // Spy-based guard: publishTeamRootToInbox must not have been called
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });

  it('G2: single-repo --pull does NOT call hydrateTeamRootFromStateRef (no sidecar when teamRoot absent)', async () => {
    const base = makeTmpDir('G2-single-pull');
    const workRemote = path.join(base, 'work-remote.git');
    const workRepo = path.join(base, 'work');

    initBareRepo(workRemote);
    initWorkingRepo(workRepo, 'origin', workRemote);

    // Write .squad/config.json so single-repo path is taken (no exit-1)
    fs.mkdirSync(path.join(workRepo, '.squad'), { recursive: true });
    fs.writeFileSync(path.join(workRepo, '.squad', 'config.json'), JSON.stringify({ stateBackend: 'orphan' }));

    // No registry entry → no teamRoot → single-repo pull path
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const hydrateSpy = vi.spyOn(_transport, 'hydrateTeamRootFromStateRef');

    try {
      await runSync({ direction: 'pull', cwd: workRepo, quiet: true });
    } catch {
      // syncPull may fail (nothing on remote) — not relevant to this assertion
    }

    expect(hydrateSpy).not.toHaveBeenCalled();
    hydrateSpy.mockRestore();
  });

  it('C1: --pull with matching registry entry calls hydrateTeamRootFromStateRef (sidecar populated)', async () => {
    const base = makeTmpDir('C1-pull');
    const docsRemote = path.join(base, 'docs-remote.git');
    const publisherRepo = path.join(base, 'publisher');
    const hydrateTeamRoot = path.join(base, 'hydrate-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(publisherRepo, 'origin', docsRemote);
    setupSquadDir(publisherRepo);

    // Publish so there is content on docsRemote
    await publishTeamRootToInbox(publisherRepo, 'origin', 'dev1', 'sess-c1');
    const docsRefs = listBareRefs(docsRemote);
    const inboxRef = docsRefs.find(r => r.includes('squad/inbox/dev1/'))!;
    expect(inboxRef).toBeTruthy();
    const inboxBranch = inboxRef.replace('refs/heads/', '');

    // hydrateTeamRoot is a fresh working clone of docsRemote (no .squad/ yet)
    initWorkingRepo(hydrateTeamRoot, 'origin', docsRemote);

    // workRepo is the product repo
    initWorkingRepo(workRepo, 'origin', docsRemote);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(hydrateTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: inboxBranch,
      }]),
      warnings: [],
    });

    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });

    // hydrateTeamRoot should now have .squad/decisions.md from the inbox snapshot
    expect(fs.existsSync(path.join(hydrateTeamRoot, '.squad', 'decisions.md'))).toBe(true);
  });

  it('C2: repeated --pull is idempotent (second call does not error)', async () => {
    const base = makeTmpDir('C2-idempotent');
    const docsRemote = path.join(base, 'docs-remote.git');
    const publisherRepo = path.join(base, 'publisher');
    const hydrateTeamRoot = path.join(base, 'hydrate-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(publisherRepo, 'origin', docsRemote);
    setupSquadDir(publisherRepo);
    await publishTeamRootToInbox(publisherRepo, 'origin', 'dev2', 'sess-c2');

    const docsRefs = listBareRefs(docsRemote);
    const inboxBranch = docsRefs.find(r => r.includes('squad/inbox/dev2/'))!.replace('refs/heads/', '');

    initWorkingRepo(hydrateTeamRoot, 'origin', docsRemote);
    initWorkingRepo(workRepo, 'origin', docsRemote);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(hydrateTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        stateBranch: inboxBranch,
      }]),
      warnings: [],
    });

    // First pull
    await runSync({ direction: 'pull', cwd: workRepo, quiet: true });
    expect(fs.existsSync(path.join(hydrateTeamRoot, '.squad', 'decisions.md'))).toBe(true);

    // Second pull — must not throw
    await expect(
      runSync({ direction: 'pull', cwd: workRepo, quiet: true })
    ).resolves.not.toThrow();
  });

  it('B3: sessionId from COPILOT_SESSION_ID when set, randomUUID() otherwise', async () => {
    const base = makeTmpDir('B3-sessionid');
    const docsRemote = path.join(base, 'docs-remote.git');
    const docsTeamRoot = path.join(base, 'docs-teamroot');
    const workRepo = path.join(base, 'work');

    initBareRepo(docsRemote);
    initWorkingRepo(docsTeamRoot, 'origin', docsRemote);
    setupSquadDir(docsTeamRoot);
    initWorkingRepo(workRepo, 'origin', docsRemote);
    const workGitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        path: path.join(docsTeamRoot, '.squad'),
        clones: [workGitRoot],
        stateRemote: 'origin',
        developerAlias: 'dev3',
      }]),
      warnings: [],
    });

    // Test 1: COPILOT_SESSION_ID present → its value appears in the inbox branch name
    process.env['COPILOT_SESSION_ID'] = 'explicit-sid-xyz';
    await runSync({ direction: 'push', cwd: workRepo, developer: 'dev3', quiet: true });

    const refs1 = listBareRefs(docsRemote);
    const withEnvSession = refs1.filter(r => r.includes('explicit-sid-xyz'));
    expect(withEnvSession).toHaveLength(1);

    // Test 2: COPILOT_SESSION_ID absent → randomUUID used (branch still created, no "undefined" in name)
    delete process.env['COPILOT_SESSION_ID'];
    await runSync({ direction: 'push', cwd: workRepo, developer: 'dev3', quiet: true });

    const refs2 = listBareRefs(docsRemote);
    const inboxRefs = refs2.filter(r => r.includes('refs/heads/squad/inbox/dev3/'));
    expect(inboxRefs).toHaveLength(2); // two pushes, two inbox branches
    expect(inboxRefs.every(r => !r.includes('undefined'))).toBe(true);
  });
});

