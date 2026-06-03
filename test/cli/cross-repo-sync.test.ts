/**
 * cross-repo-sync integration tests — piece 28
 *
 * Acceptance gate for the inbox branch publish flow.
 * Uses a purpose-built bare-repo fixture to prove concurrent
 * publishes and hydration from a synthetic fold commit.
 *
 * TDD: written RED before implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// ── Test fixture layout ────────────────────────────────────────────────────

const SUITE_DIR = join(tmpdir(), `.test-cross-repo-sync-${randomBytes(4).toString('hex')}`);
const BARE_REMOTE = join(SUITE_DIR, 'remote.git');
const DEV_A_TEAM  = join(SUITE_DIR, 'dev-a-team');
const DEV_B_TEAM  = join(SUITE_DIR, 'dev-b-team');
const DEV_C_TEAM  = join(SUITE_DIR, 'dev-c-team');
const DEV_A_WORK  = join(SUITE_DIR, 'dev-a-work');
const DEV_B_WORK  = join(SUITE_DIR, 'dev-b-work');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@squad.local',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@squad.local',
};

function git(args: string[], cwd: string, env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...GIT_ENV, ...env },
  }).trim();
}

function initBareRemote(): void {
  mkdirSync(BARE_REMOTE, { recursive: true });
  git(['init', '--bare'], BARE_REMOTE);
}

function cloneTeam(dest: string): void {
  mkdirSync(dest, { recursive: true });
  git(['clone', BARE_REMOTE, dest], SUITE_DIR);
  git(['config', 'user.email', 'test@squad.local'], dest);
  git(['config', 'user.name', 'Test'], dest);
  mkdirSync(join(dest, '.squad'), { recursive: true });
}

function seedSquadFiles(teamRoot: string, label: string): void {
  mkdirSync(join(teamRoot, '.squad', 'log'), { recursive: true });
  mkdirSync(join(teamRoot, '.squad', 'sessions', 'proj', 'main', `session-${label}`), { recursive: true });
  writeFileSync(join(teamRoot, '.squad', 'decisions.md'), `# Decisions (${label})\n`);
  writeFileSync(
    join(teamRoot, '.squad', 'log', 'entry.md'),
    `log entry from ${label}\n`,
  );
  writeFileSync(
    join(teamRoot, '.squad', 'sessions', 'proj', 'main', `session-${label}`, 'notes.md'),
    `session notes ${label}\n`,
  );
}

function makeWorkRoot(dest: string): void {
  mkdirSync(join(dest, '.git'), { recursive: true });
  writeFileSync(join(dest, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(dest, '.squad'), { recursive: true });
}

// ── Fixture setup / teardown ───────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(SUITE_DIR, { recursive: true });

  initBareRemote();

  cloneTeam(DEV_A_TEAM);
  cloneTeam(DEV_B_TEAM);
  cloneTeam(DEV_C_TEAM);

  makeWorkRoot(DEV_A_WORK);
  makeWorkRoot(DEV_B_WORK);

  seedSquadFiles(DEV_A_TEAM, 'alice');
  seedSquadFiles(DEV_B_TEAM, 'bob');
});

afterAll(() => {
  rmSync(SUITE_DIR, { recursive: true, force: true });
});

// ── Import under test ──────────────────────────────────────────────────────

import type { InboxPublishOpts } from '../../packages/squad-cli/src/cli/commands/sync.js';
import {
  publishTeamRootToInbox,
  hydrateTeamRootFromStateRef,
  hydrateWorkRootProjection,
  computeInboxBranchName,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

// ── Assertion (1): concurrent publishes from two developers cause no non-fast-forward conflicts ──

describe('concurrent publish from two developers', () => {
  it('both publishes complete without non-fast-forward rejection', async () => {
    const sessionA = randomBytes(8).toString('hex');
    const sessionB = randomBytes(8).toString('hex');

    const branchA = computeInboxBranchName('alice', sessionA);
    const branchB = computeInboxBranchName('bob', sessionB);

    const optsA: InboxPublishOpts = {
      developerAlias: 'alice',
      sessionId: sessionA,
      workRoot: DEV_A_WORK,
      baseStateCommit: '',
    };
    const optsB: InboxPublishOpts = {
      developerAlias: 'bob',
      sessionId: sessionB,
      workRoot: DEV_B_WORK,
      baseStateCommit: '',
    };

    // [FIDO HIGH] Both publishes launched concurrently via Promise.all — proves
    // race safety, not just sequential success.
    await expect(
      Promise.all([
        publishTeamRootToInbox(DEV_A_TEAM, 'origin', branchA, optsA),
        publishTeamRootToInbox(DEV_B_TEAM, 'origin', branchB, optsB),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    // Verify both branches exist on the bare remote using ls-remote
    // (avoids needing to fetch into a specific clone's remote-tracking refs)
    const remoteRefs = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad/inbox/*'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(remoteRefs).toContain(`refs/heads/${branchA}`);
    expect(remoteRefs).toContain(`refs/heads/${branchB}`);
  }, 30_000);
});

// ── Assertion (2): third clone can hydrate from a synthetic fold commit ────

describe('hydrateTeamRootFromStateRef()', () => {
  it('third clone can hydrate from a synthetic squad-state commit on the remote', async () => {
    // Create squad-state branch with an empty tree commit via git plumbing
    const emptyTree = git(['mktree'], DEV_A_TEAM);
    const stateCommit = execFileSync(
      'git', ['commit-tree', emptyTree, '-m', 'synthetic squad-state fold'],
      {
        cwd: DEV_A_TEAM,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...GIT_ENV },
      },
    ).trim();
    git(['update-ref', 'refs/heads/squad-state', stateCommit], DEV_A_TEAM);
    git(['push', 'origin', 'refs/heads/squad-state:refs/heads/squad-state'], DEV_A_TEAM);

    // Dev C clone has no local squad-state branch yet
    await expect(
      hydrateTeamRootFromStateRef(DEV_C_TEAM, 'origin', 'squad-state'),
    ).resolves.toBeUndefined();

    // Verify dev-c now has the local squad-state ref pointing to the synthetic commit
    const localSha = git(['rev-parse', 'refs/heads/squad-state'], DEV_C_TEAM);
    expect(localSha).toBe(stateCommit);
  }, 30_000);

  it('is idempotent when already at the fetched commit', async () => {
    // Should not throw when called twice
    await expect(
      hydrateTeamRootFromStateRef(DEV_C_TEAM, 'origin', 'squad-state'),
    ).resolves.toBeUndefined();
  });
});

// ── Assertion (3): publish-metadata.json has object-shaped sourceWorkRoot ─

describe('publish-metadata.json schema', () => {
  let metadataRaw: string;
  let branchName: string;

  beforeAll(async () => {
    const sessionId = randomBytes(8).toString('hex');
    branchName = computeInboxBranchName('carol', sessionId);
    const opts: InboxPublishOpts = {
      developerAlias: 'carol',
      sessionId,
      workRoot: DEV_A_WORK,
      baseStateCommit: 'abc123',
    };
    // Clone a fresh team root for carol
    const carolTeam = join(SUITE_DIR, 'carol-team');
    cloneTeam(carolTeam);
    seedSquadFiles(carolTeam, 'carol');

    await publishTeamRootToInbox(carolTeam, 'origin', branchName, opts);

    // Fetch the published metadata from the bare remote via the branch
    metadataRaw = git(
      ['show', `${branchName}:.squad/publish-metadata.json`],
      carolTeam,
    );
  }, 30_000);

  it('sourceWorkRoot is an object (not a string)', () => {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    expect(typeof metadata['sourceWorkRoot']).toBe('object');
    expect(metadata['sourceWorkRoot']).not.toBeNull();
    expect(Array.isArray(metadata['sourceWorkRoot'])).toBe(false);
  });

  it('sourceWorkRoot has repo (string) and pathHash (string)', () => {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    const swr = metadata['sourceWorkRoot'] as Record<string, unknown>;
    expect(typeof swr['repo']).toBe('string');
    expect(typeof swr['pathHash']).toBe('string');
    expect((swr['pathHash'] as string).startsWith('sha256:')).toBe(true);
  });

  // ── Assertion (4): no raw absolute path appears in publish-metadata.json ──
  it('contains no raw absolute path segment (no Users\\ or /home/ or drive letters with colons)', () => {
    // Must not contain OS-style path separators, Users/ segments, or /home/ segments
    expect(metadataRaw).not.toMatch(/Users[/\\]/);
    expect(metadataRaw).not.toMatch(/\/home\//);
    // Must not contain Windows drive-letter path like C:\
    expect(metadataRaw).not.toMatch(/[A-Za-z]:\\/);
    // Must not contain forward-slash absolute paths like /d/git/
    expect(metadataRaw).not.toMatch(/:"\/[a-z]\//);
  });

  it('publishedAt ends with Z (UTC ISO 8601)', () => {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    expect(typeof metadata['publishedAt']).toBe('string');
    expect((metadata['publishedAt'] as string).endsWith('Z')).toBe(true);
  });

  // ── [RETRO HIGH] PII assertions ────────────────────────────────────────────

  it('contains no email-shaped substring anywhere in the JSON', () => {
    expect(JSON.stringify(JSON.parse(metadataRaw))).not.toMatch(/@/);
  });

  it('contains no user-path segments (Users/, home/, Documents/)', () => {
    expect(JSON.stringify(JSON.parse(metadataRaw))).not.toMatch(/Users[/\\]|home[/\\]|Documents[/\\]/i);
  });

  it('publishedAt has explicit UTC suffix', () => {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    expect(metadata['publishedAt']).toMatch(/Z$/);
  });
});

// ── Assertion (5): pathHash is stable across two invocations from the same clone ──

describe('pathHash stability', () => {
  it('produces identical pathHash for the same workRoot on repeated calls', async () => {
    const sessionId1 = randomBytes(8).toString('hex');
    const sessionId2 = randomBytes(8).toString('hex');
    const stableTeam = join(SUITE_DIR, 'stable-team');
    cloneTeam(stableTeam);
    seedSquadFiles(stableTeam, 'stable');

    const branch1 = computeInboxBranchName('dev1', sessionId1);
    const branch2 = computeInboxBranchName('dev1', sessionId2);

    await publishTeamRootToInbox(stableTeam, 'origin', branch1, {
      developerAlias: 'dev1',
      sessionId: sessionId1,
      workRoot: DEV_A_WORK,
      baseStateCommit: '',
    });

    // Second publish with same workRoot (different sessionId → different branch)
    await publishTeamRootToInbox(stableTeam, 'origin', branch2, {
      developerAlias: 'dev1',
      sessionId: sessionId2,
      workRoot: DEV_A_WORK,
      baseStateCommit: '',
    });

    const raw1 = git(['show', `${branch1}:.squad/publish-metadata.json`], stableTeam);
    const raw2 = git(['show', `${branch2}:.squad/publish-metadata.json`], stableTeam);
    const meta1 = JSON.parse(raw1) as Record<string, unknown>;
    const meta2 = JSON.parse(raw2) as Record<string, unknown>;

    const swr1 = meta1['sourceWorkRoot'] as Record<string, unknown>;
    const swr2 = meta2['sourceWorkRoot'] as Record<string, unknown>;

    expect(swr1['pathHash']).toBe(swr2['pathHash']);
  }, 30_000);
});

// ── Assertion (6): missing or malformed developerAlias throws before creating a branch ──

describe('developerAlias validation in publishTeamRootToInbox()', () => {
  it('throws when developerAlias is an empty string', async () => {
    const validTeam = join(SUITE_DIR, 'alias-check-team');
    cloneTeam(validTeam);

    await expect(
      publishTeamRootToInbox(validTeam, 'origin', 'squad/inbox/x/bad', {
        developerAlias: '',
        sessionId: 'test-session',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('developerAlias');
  });

  it('throws when developerAlias contains uppercase letters', async () => {
    const validTeam = join(SUITE_DIR, 'alias-check-team-2');
    cloneTeam(validTeam);

    await expect(
      publishTeamRootToInbox(validTeam, 'origin', 'squad/inbox/Alice/bad', {
        developerAlias: 'Alice',
        sessionId: 'test-session',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('developerAlias');
  });

  it('throws when developerAlias starts with a digit', async () => {
    const validTeam = join(SUITE_DIR, 'alias-check-team-3');
    cloneTeam(validTeam);

    await expect(
      publishTeamRootToInbox(validTeam, 'origin', 'squad/inbox/1bad/bad', {
        developerAlias: '1bad',
        sessionId: 'test-session',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('developerAlias');
  });
});

// ── Session shard path helper ──────────────────────────────────────────────

describe('sessionShardPath()', () => {
  it('produces the correct shard path format', async () => {
    const { sessionShardPath } = await import('../../packages/squad-sdk/src/resolution.js');
    const result = sessionShardPath('proj-key', 'main', 'session-abc');
    expect(result).toBe('.squad/sessions/proj-key/main/session-abc');
  });

  it('handles all-lowercase alphanumeric segments', async () => {
    const { sessionShardPath } = await import('../../packages/squad-sdk/src/resolution.js');
    const result = sessionShardPath('myproject', 'feature-branch', 'uuid-1234-5678');
    expect(result).toBe('.squad/sessions/myproject/feature-branch/uuid-1234-5678');
  });
});

// ── hydrateWorkRootProjection ──────────────────────────────────────────────

describe('hydrateWorkRootProjection()', () => {
  it('copies .squad files from teamRoot into workRoot projection', async () => {
    const projTeam = join(SUITE_DIR, 'proj-team');
    const projWork = join(SUITE_DIR, 'proj-work');
    cloneTeam(projTeam);
    makeWorkRoot(projWork);
    seedSquadFiles(projTeam, 'proj');

    await hydrateWorkRootProjection(projWork, projTeam);

    expect(existsSync(join(projWork, '.squad', 'decisions.md'))).toBe(true);
    expect(existsSync(join(projWork, '.squad', 'log', 'entry.md'))).toBe(true);
  });

  it('does not touch files outside .squad/ in workRoot', async () => {
    const projTeam2 = join(SUITE_DIR, 'proj-team-2');
    const projWork2 = join(SUITE_DIR, 'proj-work-2');
    cloneTeam(projTeam2);
    makeWorkRoot(projWork2);
    seedSquadFiles(projTeam2, 'proj2');

    // Create a sentinel file outside .squad/
    writeFileSync(join(projWork2, 'sentinel.txt'), 'do not delete me\n');

    await hydrateWorkRootProjection(projWork2, projTeam2);

    expect(existsSync(join(projWork2, 'sentinel.txt'))).toBe(true);
  });

  // [FIDO HIGH] Deletion assertion — files in WORK_ROOT/.squad/ absent from TEAM_ROOT must be removed
  it('removes stale files from WORK_ROOT/.squad/ that have no counterpart in TEAM_ROOT', async () => {
    const projTeam3 = join(SUITE_DIR, 'proj-team-3');
    const projWork3 = join(SUITE_DIR, 'proj-work-3');
    cloneTeam(projTeam3);
    makeWorkRoot(projWork3);
    seedSquadFiles(projTeam3, 'proj3');

    // Plant a stale file inside WORK_ROOT/.squad/ — not in TEAM_ROOT
    mkdirSync(join(projWork3, '.squad'), { recursive: true });
    writeFileSync(join(projWork3, '.squad', 'should-be-removed.txt'), 'stale\n');

    // Plant a sentinel outside .squad/ — must survive unchanged
    writeFileSync(join(projWork3, 'sentinel.txt'), 'keep me\n');

    await hydrateWorkRootProjection(projWork3, projTeam3);

    expect(existsSync(join(projWork3, '.squad', 'should-be-removed.txt'))).toBe(false);
    expect(existsSync(join(projWork3, 'sentinel.txt'))).toBe(true);
  });
});

// ── [FIDO + RETRO] Allowlist fails-closed test ─────────────────────────────

describe('snapshot allowlist enforcement', () => {
  it('throws and creates no branch when TEAM_ROOT contains non-allowlisted .squad/ files', async () => {
    const restrictedTeam = join(SUITE_DIR, 'restricted-team');
    cloneTeam(restrictedTeam);
    seedSquadFiles(restrictedTeam, 'restricted');

    // Plant a non-allowlisted file inside .squad/
    writeFileSync(join(restrictedTeam, '.squad', 'secrets.json'), '{"token":"abc"}\n');

    const sessionId = randomBytes(8).toString('hex');
    const branch = computeInboxBranchName('dev1', sessionId);

    await expect(
      publishTeamRootToInbox(restrictedTeam, 'origin', branch, {
        developerAlias: 'dev1',
        sessionId,
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('.squad/secrets.json');

    // Confirm no inbox branch was created on the bare remote
    const remoteRefs = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, `refs/heads/${branch}`],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(remoteRefs).toBe('');
  });
});

// ── [RETRO HIGH] inboxBranch namespace-rejection test ─────────────────────

describe('inboxBranch namespace guard', () => {
  it('throws before any git op when inboxBranch does not start with squad/inbox/', async () => {
    const nsTeam = join(SUITE_DIR, 'ns-guard-team');
    cloneTeam(nsTeam);

    // Record current state of squad-state ref on the bare remote (may be empty)
    const refsBefore = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad-state'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    const sessionId = randomBytes(8).toString('hex');

    await expect(
      publishTeamRootToInbox(nsTeam, 'origin', 'squad-state', {
        developerAlias: 'dev1',
        sessionId,
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow("squad/inbox/");

    // squad-state ref must be unchanged — no git ops were performed
    const refsAfter = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad-state'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(refsAfter).toBe(refsBefore);
  });
});

// ── [RETRO HIGH] sessionId charset-rejection tests ─────────────────────────

describe('sessionId charset validation', () => {
  it('throws for sessionId containing @', async () => {
    const nsTeam = join(SUITE_DIR, 'session-id-guard-1');
    cloneTeam(nsTeam);
    await expect(
      publishTeamRootToInbox(nsTeam, 'origin', 'squad/inbox/dev1/test', {
        developerAlias: 'dev1',
        sessionId: 'user@example.com',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('sessionId');
  });

  it('throws for sessionId containing /', async () => {
    const nsTeam = join(SUITE_DIR, 'session-id-guard-2');
    cloneTeam(nsTeam);
    await expect(
      publishTeamRootToInbox(nsTeam, 'origin', 'squad/inbox/dev1/test', {
        developerAlias: 'dev1',
        sessionId: 'path/traversal/here',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('sessionId');
  });

  it('throws for sessionId containing ..', async () => {
    const nsTeam = join(SUITE_DIR, 'session-id-guard-3');
    cloneTeam(nsTeam);
    await expect(
      publishTeamRootToInbox(nsTeam, 'origin', 'squad/inbox/dev1/test', {
        developerAlias: 'dev1',
        sessionId: '..dotdot..',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('sessionId');
  });

  it('throws for sessionId containing whitespace', async () => {
    const nsTeam = join(SUITE_DIR, 'session-id-guard-4');
    cloneTeam(nsTeam);
    await expect(
      publishTeamRootToInbox(nsTeam, 'origin', 'squad/inbox/dev1/test', {
        developerAlias: 'dev1',
        sessionId: 'hello world12345',
        workRoot: DEV_A_WORK,
      }),
    ).rejects.toThrow('sessionId');
  });
});

// ── [CAPCOM CF-4] sessionShardPath traversal guard tests ──────────────────

describe('sessionShardPath traversal guard', () => {
  it('throws for projectKey containing ..', async () => {
    const { sessionShardPath } = await import('../../packages/squad-sdk/src/resolution.js');
    expect(() => sessionShardPath('../etc', 'main', 'abc12345')).toThrow('projectKey');
  });

  it('throws for workstream containing path traversal', async () => {
    const { sessionShardPath } = await import('../../packages/squad-sdk/src/resolution.js');
    expect(() => sessionShardPath('proj', '..\\..\\evil', 'abc12345')).toThrow('workstream');
  });

  it('throws for sessionId containing /', async () => {
    const { sessionShardPath } = await import('../../packages/squad-sdk/src/resolution.js');
    expect(() => sessionShardPath('proj', 'main', 'a/b')).toThrow('sessionId');
  });
});

// ── Sub-proposal A: runSync --push cross-repo dispatch ────────────────────
//
// Tests MUST call runSync (not publishTeamRootToInbox directly) so they
// catch CLI dispatch regressions.

describe('runSync --push cross-repo dispatch (piece 31-A)', () => {
  const CROSS_WORK = join(SUITE_DIR, 'cross-work-a');

  beforeAll(() => {
    mkdirSync(join(CROSS_WORK, '.git'), { recursive: true });
    writeFileSync(join(CROSS_WORK, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(CROSS_WORK, '.squad'), { recursive: true });
    // teamRoot is relative from CROSS_WORK to DEV_A_TEAM (forward-slash for config)
    const relTeamRoot = relative(CROSS_WORK, DEV_A_TEAM).replace(/\\/g, '/');
    writeFileSync(
      join(CROSS_WORK, '.squad', 'config.json'),
      JSON.stringify({
        version: 1,
        stateBackend: 'orphan',
        teamRoot: relTeamRoot,
        stateRemote: 'origin',
        stateBranch: 'squad-state',
        inboxBranchPrefix: 'squad/inbox',
      }, null, 2) + '\n',
    );
  });

  it('runSync --push creates squad/inbox/<alias>/... ref on remote when teamRoot is set', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    delete process.env['SQUAD_SYNC_ACTIVE'];
    delete process.env['COPILOT_SESSION_ID'];

    const gitOps = {
      listRemotes: (_cwd: string) => ['origin'],
      getRefspecs: (_cwd: string, _remote: string) => [
        '+refs/heads/squad-state:refs/remotes/origin/squad-state',
        '+refs/heads/squad/inbox/*:refs/remotes/origin/squad/inbox/*',
      ],
      addFetchRefspec: (_cwd: string, _remote: string, _refspec: string) => {},
    };

    await runSync({
      direction: 'push',
      developer: 'runtest',
      workRoot: CROSS_WORK,
      quiet: true,
      gitOps,
    });

    const remoteRefs = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad/inbox/runtest/*'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(remoteRefs).toMatch(/refs\/heads\/squad\/inbox\/runtest\//);
  }, 30_000);

  it('runSync --push single-repo config falls back to syncPush (no inbox ref created)', async () => {
    const SINGLE_WORK = join(SUITE_DIR, 'single-work-a');
    mkdirSync(join(SINGLE_WORK, '.git'), { recursive: true });
    writeFileSync(join(SINGLE_WORK, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(SINGLE_WORK, '.squad'), { recursive: true });
    writeFileSync(
      join(SINGLE_WORK, '.squad', 'config.json'),
      JSON.stringify({ version: 1, stateBackend: 'orphan' }, null, 2) + '\n',
    );

    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    delete process.env['SQUAD_SYNC_ACTIVE'];

    const gitOps = {
      listRemotes: (_cwd: string) => ['squad-docs'],
      getRefspecs: (_cwd: string, _remote: string) => [
        '+refs/heads/squad-state:refs/remotes/squad-docs/squad-state',
        '+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*',
      ],
      addFetchRefspec: (_cwd: string, _remote: string, _refspec: string) => {},
    };

    // syncPush will fail on the fake git dir (no real branches) — that's expected
    const refsBefore = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad/inbox/singleonly/*'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    try {
      await runSync({
        direction: 'push',
        developer: 'singleonly',
        workRoot: SINGLE_WORK,
        quiet: true,
        gitOps,
      });
    } catch { /* expected — syncPush on fake git dir may throw */ }

    const refsAfter = execFileSync(
      'git', ['ls-remote', BARE_REMOTE, 'refs/heads/squad/inbox/singleonly/*'],
      { cwd: SUITE_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    // No inbox ref should have been created for single-repo config
    expect(refsAfter).toBe(refsBefore);
  }, 15_000);
});

// ── Sub-proposal C: runSync --pull hydrates TEAM_ROOT ────────────────────
//
// Tests MUST call runSync (not hydrateTeamRootFromStateRef directly).

describe('runSync --pull hydrates TEAM_ROOT from state ref (piece 31-C)', () => {
  const CROSS_PULL_WORK = join(SUITE_DIR, 'cross-work-c');
  const HYDRATE_TEAM   = join(SUITE_DIR, 'hydrate-team-c');

  beforeAll(() => {
    // Fresh clone of BARE_REMOTE for the TEAM_ROOT sidecar
    cloneTeam(HYDRATE_TEAM);

    mkdirSync(join(CROSS_PULL_WORK, '.git'), { recursive: true });
    writeFileSync(join(CROSS_PULL_WORK, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(join(CROSS_PULL_WORK, '.squad'), { recursive: true });
    const relTeamRoot = relative(CROSS_PULL_WORK, HYDRATE_TEAM).replace(/\\/g, '/');
    writeFileSync(
      join(CROSS_PULL_WORK, '.squad', 'config.json'),
      JSON.stringify({
        version: 1,
        stateBackend: 'orphan',
        teamRoot: relTeamRoot,
        stateRemote: 'origin',
        stateBranch: 'squad-state',
      }, null, 2) + '\n',
    );
  });

  it('runSync --pull populates TEAM_ROOT with squad-state branch content', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    delete process.env['SQUAD_SYNC_ACTIVE'];

    const gitOps = {
      listRemotes: (_cwd: string) => ['origin'],
      getRefspecs: (_cwd: string, _remote: string) => [
        '+refs/heads/squad-state:refs/remotes/origin/squad-state',
        '+refs/heads/squad/inbox/*:refs/remotes/origin/squad/inbox/*',
      ],
      addFetchRefspec: (_cwd: string, _remote: string, _refspec: string) => {},
    };

    await runSync({
      direction: 'pull',
      workRoot: CROSS_PULL_WORK,
      quiet: true,
      gitOps,
    });

    // HYDRATE_TEAM should now have squad-state ref updated from BARE_REMOTE
    const localSha = execFileSync(
      'git', ['rev-parse', 'refs/heads/squad-state'],
      { cwd: HYDRATE_TEAM, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(localSha).toBeTruthy();
    expect(localSha).toMatch(/^[0-9a-f]{40}$/);
  }, 30_000);

  it('runSync --pull is idempotent — second pull does not change the ref', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    delete process.env['SQUAD_SYNC_ACTIVE'];

    const shaBefore = execFileSync(
      'git', ['rev-parse', 'refs/heads/squad-state'],
      { cwd: HYDRATE_TEAM, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    const gitOps = {
      listRemotes: (_cwd: string) => ['origin'],
      getRefspecs: (_cwd: string, _remote: string) => [
        '+refs/heads/squad-state:refs/remotes/origin/squad-state',
        '+refs/heads/squad/inbox/*:refs/remotes/origin/squad/inbox/*',
      ],
      addFetchRefspec: (_cwd: string, _remote: string, _refspec: string) => {},
    };

    await runSync({
      direction: 'pull',
      workRoot: CROSS_PULL_WORK,
      quiet: true,
      gitOps,
    });

    const shaAfter = execFileSync(
      'git', ['rev-parse', 'refs/heads/squad-state'],
      { cwd: HYDRATE_TEAM, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    expect(shaAfter).toBe(shaBefore);
  }, 30_000);
});
