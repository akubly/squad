/**
 * Cross-repo state transport helpers — piece 32.5
 *
 * Tests for publishTeamRootToInbox and hydrateTeamRootFromStateRef.
 * Exercises both helpers directly against bare-repo fixtures and real
 * working clones. No mocks; no runSync integration.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

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
});

afterEach(() => {
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
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

  it('8. path outside allowlist (.squad/config.json) causes error BEFORE any commit on remote', async () => {
    const base = makeTmpDir('allowlist-guard');
    const bare = path.join(base, 'bare.git');
    const repo = path.join(base, 'work');

    initBareRepo(bare);
    initWorkingRepo(repo, 'origin', bare);
    setupSquadDir(repo);

    // Plant a non-allowlisted file
    fs.writeFileSync(path.join(repo, '.squad', 'config.json'), '{"stateBackend":"worktree"}');

    await expect(publishTeamRootToInbox(repo, 'origin', 'dev1', 'sess-y')).rejects.toThrow(
      /outside the allowed/,
    );

    // No commit objects should have been pushed
    const refs = listBareRefs(bare);
    expect(refs.filter(r => r.includes('/squad/inbox/'))).toHaveLength(0);
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

  it('6. hydrateTeamRootFromStateRef is idempotent — second call when HEAD equals the state commit SHA is a true no-op (no fs writes)', async () => {
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

    // Explicitly set hydrateRepo's HEAD to the fetched state commit so the idempotency
    // guard (Step 3: HEAD == fetchedSha → return early) fires on the second call.
    // This simulates a session where the tree was already applied and HEAD recorded.
    const fetchedSha = execFileSync('git', ['rev-parse', `refs/remotes/origin/${stateBranch}`], {
      cwd: hydrateRepo, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
    execFileSync('git', ['update-ref', 'HEAD', fetchedSha], {
      cwd: hydrateRepo, stdio: 'pipe',
    });

    // Spy on fs.writeFileSync to assert that no writes occur on the idempotent call.
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    await hydrateTeamRootFromStateRef(hydrateRepo, 'origin', stateBranch);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
