/**
 * Bind Command Tests — CLI command for cross-repo docs sidecar setup
 *
 * Tests runBind() through the BindGitOps injection seam so no real git
 * or network calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { BindGitOps } from '../../packages/squad-cli/src/cli/commands/bind.js';

const TEST_ROOT = join(tmpdir(), `.test-cli-bind-${randomBytes(4).toString('hex')}`);
const WORK_ROOT = join(TEST_ROOT, 'work-repo');
const TEAM_CACHE = join(TEST_ROOT, 'team-cache');
const TEAM_REPO_URL = 'https://example.com/team-docs.git';

interface TrackedGitOps extends BindGitOps {
  calls: { method: string; args: unknown[] }[];
}

/** Minimal no-op git ops stub that records calls */
function makeGitOps(overrides: Partial<BindGitOps> = {}): TrackedGitOps {
  const calls: { method: string; args: unknown[] }[] = [];

  const ops: TrackedGitOps = {
    calls,
    cloneOrFetch(url: string, dest: string): void {
      calls.push({ method: 'cloneOrFetch', args: [url, dest] });
      // Simulate the sidecar directory existing after clone
      mkdirSync(dest, { recursive: true });
      overrides.cloneOrFetch?.(url, dest);
    },
    addRemote(cwd: string, name: string, url: string): void {
      calls.push({ method: 'addRemote', args: [cwd, name, url] });
      overrides.addRemote?.(cwd, name, url);
    },
    addRefspec(cwd: string, remoteName: string, refspec: string): void {
      calls.push({ method: 'addRefspec', args: [cwd, remoteName, refspec] });
      overrides.addRefspec?.(cwd, remoteName, refspec);
    },
    syncPull(cwd: string): void {
      calls.push({ method: 'syncPull', args: [cwd] });
      overrides.syncPull?.(cwd);
    },
  };
  return ops;
}

/** Create a fake .git directory so install-hooks and exclude logic work */
function seedFakeGitDir(repoRoot: string): void {
  const gitDir = join(repoRoot, '.git');
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  mkdirSync(join(gitDir, 'hooks'), { recursive: true });
  // Minimal HEAD so git recognizes this as a repo
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
}

describe('CLI: bind command', () => {
  beforeEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(WORK_ROOT, { recursive: true });
    seedFakeGitDir(WORK_ROOT);
  });

  afterEach(() => {
    if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('module exports runBind and BindGitOps-typed surface', async () => {
    const mod = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    expect(typeof mod.runBind).toBe('function');
    expect(typeof mod.DEFAULT_GIT_OPS).toBe('object');
  });

  it('writes config.json with correct fields', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const configPath = join(WORK_ROOT, '.squad', 'config.json');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(1);
    expect(config.stateRemote).toBe('squad-docs');
    expect(config.stateBranch).toBe('squad-state');
    expect(config.inboxBranchPrefix).toBe('squad/inbox');
    expect(typeof config.teamRoot).toBe('string');
  });

  it('applies custom stateRemote, stateBranch, and inboxBranchPrefix', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({
      workRoot: WORK_ROOT,
      teamRepoUrl: TEAM_REPO_URL,
      teamCachePath: TEAM_CACHE,
      stateRemote: 'my-docs',
      stateBranch: 'docs-state',
      inboxBranchPrefix: 'my/inbox',
      gitOps,
    });

    const config = JSON.parse(readFileSync(join(WORK_ROOT, '.squad', 'config.json'), 'utf-8'));
    expect(config.stateRemote).toBe('my-docs');
    expect(config.stateBranch).toBe('docs-state');
    expect(config.inboxBranchPrefix).toBe('my/inbox');
  });

  it('stores developerAlias in config when provided', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({
      workRoot: WORK_ROOT,
      teamRepoUrl: TEAM_REPO_URL,
      teamCachePath: TEAM_CACHE,
      developerAlias: 'alice',
      gitOps,
    });

    const config = JSON.parse(readFileSync(join(WORK_ROOT, '.squad', 'config.json'), 'utf-8'));
    expect(config.developerAlias).toBe('alice');
  });

  it('calls addRemote with correct name and url', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const addRemoteCall = gitOps.calls.find(c => c.method === 'addRemote');
    expect(addRemoteCall).toBeTruthy();
    expect(addRemoteCall?.args[1]).toBe('squad-docs');
    expect(addRemoteCall?.args[2]).toBe(TEAM_REPO_URL);
  });

  it('addRemote is called even when remote already exists (implementation is idempotent)', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    // First run
    const gitOps = makeGitOps();
    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });
    // Second run — addRemote stub silently absorbs the re-add
    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const addRemoteCalls = gitOps.calls.filter(c => c.method === 'addRemote');
    expect(addRemoteCalls.length).toBe(2);
  });

  it('sets refspec for squad-state branch', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const refspecCalls = gitOps.calls.filter(c => c.method === 'addRefspec');
    const stateBranchRefspec = refspecCalls.find(c =>
      (c.args[2] as string).includes('squad-state'),
    );
    expect(stateBranchRefspec).toBeTruthy();
    expect(stateBranchRefspec?.args[2]).toBe(
      '+refs/heads/squad-state:refs/remotes/squad-docs/squad-state',
    );
  });

  it('sets refspec for squad/inbox wildcard', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const refspecCalls = gitOps.calls.filter(c => c.method === 'addRefspec');
    const inboxRefspec = refspecCalls.find(c =>
      (c.args[2] as string).includes('inbox'),
    );
    expect(inboxRefspec).toBeTruthy();
    expect(inboxRefspec?.args[2]).toBe(
      '+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*',
    );
  });

  it('appends .squad/ to .git/info/exclude', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const excludePath = join(WORK_ROOT, '.git', 'info', 'exclude');
    expect(existsSync(excludePath)).toBe(true);
    const content = readFileSync(excludePath, 'utf-8');
    expect(content).toContain('.squad/');
  });

  it('appends .github/agents/* to .git/info/exclude', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const content = readFileSync(join(WORK_ROOT, '.git', 'info', 'exclude'), 'utf-8');
    expect(content).toContain('.github/agents/*');
  });

  it('exclude entries are not duplicated on re-run', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });
    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const content = readFileSync(join(WORK_ROOT, '.git', 'info', 'exclude'), 'utf-8');
    const squadEntries = content.split('\n').filter(l => l.trim() === '.squad/');
    expect(squadEntries.length).toBe(1);
    const agentEntries = content.split('\n').filter(l => l.trim() === '.github/agents/*');
    expect(agentEntries.length).toBe(1);
  });

  it('does not overwrite existing exclude content', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();
    const excludePath = join(WORK_ROOT, '.git', 'info', 'exclude');

    writeFileSync(excludePath, '# existing entry\ndist/\n');
    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const content = readFileSync(excludePath, 'utf-8');
    expect(content).toContain('dist/');
    expect(content).toContain('.squad/');
  });

  it('exclude entries use forward-slash pattern (cross-platform)', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const content = readFileSync(join(WORK_ROOT, '.git', 'info', 'exclude'), 'utf-8');
    // Entries must use forward slashes, never backslashes
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      expect(line).not.toMatch(/\\/);
    }
  });

  it('re-running runBind on an already-configured WORK_ROOT is a no-op (idempotent)', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });
    const configAfterFirst = readFileSync(join(WORK_ROOT, '.squad', 'config.json'), 'utf-8');

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });
    const configAfterSecond = readFileSync(join(WORK_ROOT, '.squad', 'config.json'), 'utf-8');

    expect(configAfterSecond).toBe(configAfterFirst);
  });

  it('calls cloneOrFetch with teamRepoUrl and teamCachePath', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const cloneCall = gitOps.calls.find(c => c.method === 'cloneOrFetch');
    expect(cloneCall?.args[0]).toBe(TEAM_REPO_URL);
    expect(cloneCall?.args[1]).toBe(TEAM_CACHE);
  });

  it('calls syncPull after setup', async () => {
    const { runBind } = await import('../../packages/squad-cli/src/cli/commands/bind.js');
    const gitOps = makeGitOps();

    await runBind({ workRoot: WORK_ROOT, teamRepoUrl: TEAM_REPO_URL, teamCachePath: TEAM_CACHE, gitOps });

    const syncCall = gitOps.calls.find(c => c.method === 'syncPull');
    expect(syncCall).toBeTruthy();
  });
});
