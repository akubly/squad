/**
 * sync command tests — piece 27
 *
 * Tests runSync() and ensureStateRemote() through the SyncGitOps injection
 * seam so no real git or network calls are made.
 *
 * TDD: written RED before implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { SyncGitOps } from '../../packages/squad-cli/src/cli/commands/sync.js';

const TEST_ROOT = join(tmpdir(), `.test-cli-sync-${randomBytes(4).toString('hex')}`);
const WORK_ROOT = join(TEST_ROOT, 'work-repo');

interface TrackedGitOps extends SyncGitOps {
  calls: { method: string; args: unknown[] }[];
  remotes: string[];
  refspecs: string[];
}

function makeGitOps(overrides: {
  remotes?: string[];
  refspecs?: string[];
} = {}): TrackedGitOps {
  const calls: { method: string; args: unknown[] }[] = [];
  const remotes = overrides.remotes ?? ['squad-docs'];
  const refspecs = overrides.refspecs ?? [];

  return {
    calls,
    remotes,
    refspecs,
    listRemotes(_cwd: string): string[] {
      calls.push({ method: 'listRemotes', args: [_cwd] });
      return [...remotes];
    },
    getRefspecs(_cwd: string, remoteName: string): string[] {
      calls.push({ method: 'getRefspecs', args: [_cwd, remoteName] });
      return [...refspecs];
    },
    addFetchRefspec(_cwd: string, remoteName: string, refspec: string): void {
      calls.push({ method: 'addFetchRefspec', args: [_cwd, remoteName, refspec] });
      refspecs.push(refspec);
    },
  };
}

function seedWorkRoot(opts: { stateRemote?: string; developerAlias?: string; stateBackend?: string } = {}): void {
  mkdirSync(join(WORK_ROOT, '.squad'), { recursive: true });
  mkdirSync(join(WORK_ROOT, '.git'), { recursive: true });
  writeFileSync(join(WORK_ROOT, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const config: Record<string, unknown> = { version: 1, stateBackend: opts.stateBackend ?? 'orphan' };
  if (opts.stateRemote !== undefined) config.stateRemote = opts.stateRemote;
  if (opts.developerAlias !== undefined) config.developerAlias = opts.developerAlias;
  writeFileSync(join(WORK_ROOT, '.squad', 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

beforeEach(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  // Reset recursion guard env var between tests
  delete process.env['SQUAD_SYNC_ACTIVE'];
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env['SQUAD_SYNC_ACTIVE'];
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ensureStateRemote
// ---------------------------------------------------------------------------

describe('ensureStateRemote()', () => {
  it('exits 1 with bind-guidance message when remote is absent', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: [] }); // no remotes configured

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error(`process.exit(${_code})`);
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps)).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('squad bind'));
  });

  it('appends both required refspecs when neither is present', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['squad-docs'], refspecs: [] });

    await ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps);

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    expect(addCalls).toHaveLength(2);
    expect(addCalls[0]!.args[2]).toBe('+refs/heads/squad-state:refs/remotes/squad-docs/squad-state');
    expect(addCalls[1]!.args[2]).toBe('+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*');
  });

  it('skips refspecs that are already present (idempotent)', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const existing = [
      '+refs/heads/squad-state:refs/remotes/squad-docs/squad-state',
      '+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*',
    ];
    const gitOps = makeGitOps({ remotes: ['squad-docs'], refspecs: existing });

    await ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps);

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    expect(addCalls).toHaveLength(0);
  });

  it('appends only the missing refspec without touching existing ones', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const existing = ['+refs/heads/squad-state:refs/remotes/squad-docs/squad-state'];
    const gitOps = makeGitOps({ remotes: ['squad-docs'], refspecs: existing });

    await ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps);

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]!.args[2]).toBe('+refs/heads/squad/inbox/*:refs/remotes/squad-docs/squad/inbox/*');
  });

  it('uses the provided remote name in refspecs (non-default remote)', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['my-docs'], refspecs: [] });

    await ensureStateRemote(WORK_ROOT, 'my-docs', gitOps);

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    expect(addCalls).toHaveLength(2);
    expect(addCalls[0]!.args[2]).toContain('refs/remotes/my-docs/squad-state');
    expect(addCalls[1]!.args[2]).toContain('refs/remotes/my-docs/squad/inbox/*');
  });

  it('is idempotent on repeated calls', async () => {
    const { ensureStateRemote } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['squad-docs'], refspecs: [] });

    await ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps);
    await ensureStateRemote(WORK_ROOT, 'squad-docs', gitOps);

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    // After first call, both refspecs are in the tracked list.
    // Second call should add nothing.
    expect(addCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Remote resolution order
// ---------------------------------------------------------------------------

describe('remote resolution order', () => {
  it('uses --remote CLI flag when provided (overrides config and default)', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot({ stateRemote: 'config-remote' });
    const gitOps = makeGitOps({ remotes: ['cli-remote'] });

    // Spy on syncPull/syncPush calls — we check them via ensureStateRemote calls
    const ensureCall = gitOps.calls;

    await runSync({ direction: 'pull', remote: 'cli-remote', workRoot: WORK_ROOT, quiet: true, gitOps });

    const ensureCalls = ensureCall.filter(c => c.method === 'listRemotes');
    // ensureStateRemote should have been called with 'cli-remote'
    expect(ensureCalls.length).toBeGreaterThan(0);
    // The remote passed to listRemotes is the cwd, not the name — check via addFetchRefspec
    const addCalls = ensureCall.filter(c => c.method === 'addFetchRefspec');
    // All refspec additions should use cli-remote
    for (const call of addCalls) {
      expect(String(call.args[1])).toBe('cli-remote');
    }
  });

  it('uses config stateRemote when no --remote flag provided', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot({ stateRemote: 'config-docs' });
    const gitOps = makeGitOps({ remotes: ['config-docs'] });

    await runSync({ direction: 'pull', workRoot: WORK_ROOT, quiet: true, gitOps });

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    for (const call of addCalls) {
      expect(String(call.args[1])).toBe('config-docs');
    }
  });

  it('falls back to "squad-docs" when neither --remote nor config stateRemote is present', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot(); // no stateRemote in config
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await runSync({ direction: 'pull', workRoot: WORK_ROOT, quiet: true, gitOps });

    const addCalls = gitOps.calls.filter(c => c.method === 'addFetchRefspec');
    for (const call of addCalls) {
      expect(String(call.args[1])).toBe('squad-docs');
    }
  });
});

// ---------------------------------------------------------------------------
// --developer alias guard
// ---------------------------------------------------------------------------

describe('--developer alias guard', () => {
  it('exits 1 with descriptive message when developer alias is empty string and --push is used', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot(); // no developerAlias in config

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error(`process.exit(${_code})`);
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runSync({ direction: 'push', developer: '', workRoot: WORK_ROOT, quiet: true }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--developer'));
  });

  it('exits 1 when push is required and both --developer and config developerAlias are absent', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot(); // no developerAlias

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runSync({ direction: 'push', workRoot: WORK_ROOT, quiet: true }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts developerAlias from config when --developer is not provided', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot({ developerAlias: 'alice' });
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    // Should NOT exit 1
    await expect(
      runSync({ direction: 'push', workRoot: WORK_ROOT, quiet: true, gitOps }),
    ).resolves.not.toThrow();
  });

  it('accepts a non-empty --developer override', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await expect(
      runSync({ direction: 'push', developer: 'bob', workRoot: WORK_ROOT, quiet: true, gitOps }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Direction flags
// ---------------------------------------------------------------------------

describe('direction flags', () => {
  it('--pull direction calls ensureStateRemote', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await runSync({ direction: 'pull', workRoot: WORK_ROOT, quiet: true, gitOps });

    const listCalls = gitOps.calls.filter(c => c.method === 'listRemotes');
    expect(listCalls.length).toBeGreaterThan(0);
  });

  it('--push direction calls ensureStateRemote', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot({ developerAlias: 'alice' });
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await runSync({ direction: 'push', workRoot: WORK_ROOT, quiet: true, gitOps });

    const listCalls = gitOps.calls.filter(c => c.method === 'listRemotes');
    expect(listCalls.length).toBeGreaterThan(0);
  });

  it('--both direction calls ensureStateRemote (at least once)', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot({ developerAlias: 'alice' });
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await runSync({ direction: 'both', workRoot: WORK_ROOT, quiet: true, gitOps });

    const listCalls = gitOps.calls.filter(c => c.method === 'listRemotes');
    expect(listCalls.length).toBeGreaterThan(0);
  });

  it('hydrate-only direction calls ensureStateRemote (pull path)', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot();
    const gitOps = makeGitOps({ remotes: ['squad-docs'] });

    await runSync({ direction: 'hydrate-only', workRoot: WORK_ROOT, quiet: true, gitOps });

    const listCalls = gitOps.calls.filter(c => c.method === 'listRemotes');
    expect(listCalls.length).toBeGreaterThan(0);
  });

  it('publish-only direction requires developer alias', async () => {
    const { runSync } = await import('../../packages/squad-cli/src/cli/commands/sync.js');
    seedWorkRoot(); // no developerAlias

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runSync({ direction: 'publish-only', workRoot: WORK_ROOT, quiet: true }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
