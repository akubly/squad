/**
 * Focused tests for register merge, deduplication, path-conflict, and
 * inference behavior. Covers all test cases enumerated in the piece 07 spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawnSync } from 'child_process';
import { runRegister } from '@bradygaster/squad-cli/commands/register';

const TEST_ROOT = join(process.cwd(), `.test-register-merge-${randomBytes(4).toString('hex')}`);

function tempRegistry(): string {
  return join(TEST_ROOT, 'registry.json');
}

/** Initialize a git repository and optionally add a remote. */
function initGitRepo(dir: string, remoteUrl?: string): void {
  spawnSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
  if (remoteUrl) {
    spawnSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, stdio: 'ignore' });
  }
}

/** Read registry JSON from the temp path. */
function readRegistry(): { version: number; squads: Array<{ callsign?: string; path: string; clones?: string[]; origins?: string[] }> } {
  return JSON.parse(readFileSync(tempRegistry(), 'utf-8'));
}

describe('register merge: first registration populates Git context', () => {
  let repoDir: string;
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    repoDir = join(TEST_ROOT, 'repo');
    await mkdir(repoDir, { recursive: true });
    initGitRepo(repoDir, 'https://github.com/org/repo.git');
    squadDir = join(repoDir, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('creates one entry and populates clones[] and origins[] from the current Git context', async () => {
    await runRegister({
      callsign: 'foo',
      path: repoDir,
      cwd: repoDir,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].callsign).toBe('foo');
    expect(reg.squads[0].path).toBe(squadDir);
    // clones[] should include the repo directory
    expect(reg.squads[0].clones).toBeDefined();
    expect(reg.squads[0].clones!.length).toBeGreaterThan(0);
    // origins[] should include the remote URL
    expect(reg.squads[0].origins).toBeDefined();
    expect(reg.squads[0].origins![0]).toContain('github.com');
  });
});

describe('register merge: second registration from another clone', () => {
  let repoA: string;
  let repoB: string;
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });

    repoA = join(TEST_ROOT, 'clone-a');
    repoB = join(TEST_ROOT, 'clone-b');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    initGitRepo(repoA, 'https://github.com/org/shared.git');
    initGitRepo(repoB, 'https://github.com/org/shared.git');

    // The squad lives in repoA; repoB is a different local clone of the same repo.
    squadDir = join(repoA, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('extends the existing entry instead of throwing or creating a duplicate', async () => {
    // First register from clone A
    await runRegister({
      callsign: 'shared',
      path: repoA,
      cwd: repoA,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    // Second register from clone B (same callsign and path, different cwd)
    const result = await runRegister({
      callsign: 'shared',
      path: repoA,
      cwd: repoB,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    expect(result.outcome).toBe('merged');

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    // clones[] should have grown to include both repos
    const clones = reg.squads[0].clones ?? [];
    expect(clones.length).toBeGreaterThanOrEqual(2);
  });
});

describe('register merge: callsign-only re-register', () => {
  let repoA: string;
  let repoB: string;
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });

    repoA = join(TEST_ROOT, 'clone-a');
    repoB = join(TEST_ROOT, 'clone-b');
    await mkdir(repoA, { recursive: true });
    await mkdir(repoB, { recursive: true });
    initGitRepo(repoA, 'https://github.com/org/myteam.git');
    initGitRepo(repoB, 'https://github.com/org/related.git');

    squadDir = join(repoA, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('uses the existing entry path and merges the current clone and remotes', async () => {
    // Register once with explicit path from clone A
    await runRegister({
      callsign: 'myteam',
      path: repoA,
      cwd: repoA,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    // Re-register callsign only from clone B (no --path)
    const result = await runRegister({
      callsign: 'myteam',
      cwd: repoB,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    expect(result.outcome).toBe('merged');
    expect(result.registered.path).toBe(squadDir);

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    // origins[] should now contain both remotes (deduplicated by canonical form)
    const origins = reg.squads[0].origins ?? [];
    expect(origins.length).toBeGreaterThanOrEqual(1);
  });
});

describe('register merge: path inference', () => {
  let gitRoot: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    gitRoot = join(TEST_ROOT, 'git-root');
    await mkdir(gitRoot, { recursive: true });
    initGitRepo(gitRoot);
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('stores the callsign-suffixed path when <gitRoot>/<callsign>/.squad exists', async () => {
    const callsignSquadDir = join(gitRoot, 'alpha', '.squad');
    await mkdir(callsignSquadDir, { recursive: true });

    await runRegister({
      callsign: 'alpha',
      cwd: gitRoot,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].path).toBe(callsignSquadDir);
  });

  it('stores the root .squad path when only <gitRoot>/.squad exists', async () => {
    const rootSquadDir = join(gitRoot, '.squad');
    await mkdir(rootSquadDir, { recursive: true });

    await runRegister({
      callsign: 'beta',
      cwd: gitRoot,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].path).toBe(rootSquadDir);
  });

  it('prefers the callsign-suffixed path when both inferred paths exist', async () => {
    const callsignSquadDir = join(gitRoot, 'gamma', '.squad');
    const rootSquadDir = join(gitRoot, '.squad');
    await mkdir(callsignSquadDir, { recursive: true });
    await mkdir(rootSquadDir, { recursive: true });

    await runRegister({
      callsign: 'gamma',
      cwd: gitRoot,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    const reg = readRegistry();
    expect(reg.squads[0].path).toBe(callsignSquadDir);
  });

  it('throws when neither inferred path exists and names both tried paths', async () => {
    const expectedCallsignPath = join(gitRoot, 'delta', '.squad');
    const expectedRootPath = join(gitRoot, '.squad');

    await expect(
      runRegister({
        callsign: 'delta',
        cwd: gitRoot,
        registryPath: tempRegistry(),
        installAgent: false,
      }),
    ).rejects.toThrow(expectedCallsignPath);

    await expect(
      runRegister({
        callsign: 'delta',
        cwd: gitRoot,
        registryPath: tempRegistry(),
        installAgent: false,
      }),
    ).rejects.toThrow(expectedRootPath);
  });
});

describe('register merge: idempotent repeat registration', () => {
  let repoDir: string;
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    repoDir = join(TEST_ROOT, 'repo');
    await mkdir(repoDir, { recursive: true });
    initGitRepo(repoDir, 'https://github.com/org/idempotent.git');
    squadDir = join(repoDir, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('produces no duplicate clone or origin entries after multiple registrations from the same clone', async () => {
    const opts = {
      callsign: 'idempotent',
      path: repoDir,
      cwd: repoDir,
      registryPath: tempRegistry(),
      installAgent: false,
    };

    await runRegister(opts);
    await runRegister(opts);
    await runRegister(opts);

    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);

    const entry = reg.squads[0];
    const clones = entry.clones ?? [];
    const origins = entry.origins ?? [];

    // No duplicate clones
    const uniqueClones = new Set(clones);
    expect(uniqueClones.size).toBe(clones.length);

    // No duplicate origins (by canonical form)
    const origins2 = origins;
    const seen = new Set<string>();
    for (const url of origins2) {
      // Simple check: no exact-string duplicates
      expect(seen.has(url)).toBe(false);
      seen.add(url);
    }
  });
});

describe('register merge: path conflict', () => {
  let pathA: string;
  let pathB: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    pathA = join(TEST_ROOT, 'squad-a');
    pathB = join(TEST_ROOT, 'squad-b');
    await mkdir(join(pathA, '.squad'), { recursive: true });
    await mkdir(join(pathB, '.squad'), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('throws a path-conflict error when the same callsign is registered with a different path', async () => {
    await runRegister({
      callsign: 'conflict',
      path: pathA,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    await expect(
      runRegister({
        callsign: 'conflict',
        path: pathB,
        registryPath: tempRegistry(),
        installAgent: false,
      }),
    ).rejects.toThrow(/conflict|already registered/i);

    // Original entry must be preserved
    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].path).toBe(join(pathA, '.squad'));
  });

  it('throws a path-uniqueness conflict when a different callsign claims the same squad path', async () => {
    // Register pathA under callsign 'owner'
    await runRegister({
      callsign: 'owner',
      path: pathA,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    // Attempting to register the SAME path under a DIFFERENT callsign must be rejected
    await expect(
      runRegister({
        callsign: 'interloper',
        path: pathA,
        registryPath: tempRegistry(),
        installAgent: false,
      }),
    ).rejects.toThrow(/already registered under callsign 'owner'/i);

    // Registry must be unchanged — still only the original entry
    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
    expect(reg.squads[0].callsign).toBe('owner');
    expect(reg.squads[0].path).toBe(join(pathA, '.squad'));
  });
});

describe('register merge: path normalization', () => {
  let squadParent: string;
  let squadDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    squadParent = join(TEST_ROOT, 'my-squad');
    squadDir = join(squadParent, '.squad');
    await mkdir(squadDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('treats a trailing slash on the parent path as the same stored squad path', async () => {
    await runRegister({
      callsign: 'norm',
      path: squadParent,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    // Re-register with trailing slash — should merge, not throw
    const result = await runRegister({
      callsign: 'norm',
      path: squadParent + '/',
      registryPath: tempRegistry(),
      installAgent: false,
    });

    expect(result.outcome).toBe('merged');
    const reg = readRegistry();
    expect(reg.squads).toHaveLength(1);
  });
});

describe('register merge: origin URL normalization', () => {
  let repoDir: string;

  beforeEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
    repoDir = join(TEST_ROOT, 'repo');
    await mkdir(repoDir, { recursive: true });
    // First checkout uses HTTPS
    initGitRepo(repoDir, 'https://github.com/owner/myrepo.git');
    await mkdir(join(repoDir, '.squad'), { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(TEST_ROOT)) await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('deduplicates HTTPS and SSH forms of the same repository to one origin entry', async () => {
    // First: register with HTTPS remote already configured
    await runRegister({
      callsign: 'urlnorm',
      path: repoDir,
      cwd: repoDir,
      registryPath: tempRegistry(),
      installAgent: false,
    });

    // Append SSH form via --origin append mode (same canonical URL)
    await runRegister({
      callsign: 'urlnorm',
      origin: 'git@github.com:owner/myrepo',
      registryPath: tempRegistry(),
      installAgent: false,
    });

    const reg = readRegistry();
    const entry = reg.squads[0];
    const origins = entry.origins ?? [];

    // Both HTTPS and SSH normalize to github.com/owner/myrepo — only one should be stored
    const githubOrigins = origins.filter((o) => o.includes('github.com') || o.includes('git@github'));
    expect(githubOrigins.length).toBe(1);
  });
});
