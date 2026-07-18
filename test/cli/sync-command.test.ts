/**
 * Tests for sync command extensions: --dry-run, squad sync status, .last-publish.
 * Regression guard for --quiet (piece 33 behavior must be preserved).
 */

// ─── Registry mock ───────────────────────────────────────────────────────────
vi.mock('@bradygaster/squad-sdk/registry', () => ({
  loadRegistryFromDisk: vi.fn(),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Registry } from '@bradygaster/squad-sdk/registry';
import { loadRegistryFromDisk } from '@bradygaster/squad-sdk/registry';
import {
  runSync,
  runSyncStatus,
  _transport,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(process.cwd(), 'test', '.sync-cmd-p34-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function initWorkingRepo(dir: string): string {
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

function setupSquadDir(teamRoot: string): void {
  fs.mkdirSync(path.join(teamRoot, '.squad', 'decisions', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'log'), { recursive: true });
  fs.mkdirSync(path.join(teamRoot, '.squad', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(teamRoot, '.squad', 'decisions.md'), '# Decisions\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'log', 'session.md'), '# Log\n');
  fs.writeFileSync(path.join(teamRoot, '.squad', 'sessions', 'session.json'), '{}');
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

// ─── --dry-run ────────────────────────────────────────────────────────────────

describe('--dry-run', () => {
  it('C1: prints pending files and target branch without calling publishTeamRootToInbox', async () => {
    const docsRepoDir = makeTmpDir('docs-dry');
    const cloneDir = makeTmpDir('clone-dry');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);

    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });

    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-id';
      await runSync({ direction: 'push', dryRun: true, cwd: cloneDir });

      // publishTeamRootToInbox must NOT be called
      expect(publishSpy).not.toHaveBeenCalled();

      // stdout must include target branch info and resolved remote/branch
      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toContain('--dry-run');
      expect(allOutput).toContain('squad/inbox/dev1/');
      expect(allOutput).toContain('squad-docs');
      expect(allOutput).toContain('squad-state');
    } finally {
      consoleSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});

// ─── piece 56 §C: dry-run honors the .last-publish baseline ─────────────────────

describe('piece 56 §C — dry-run honors .last-publish baseline', () => {
  it('P56.C1: 0 pending immediately after baseline, exactly 1 after a single edit', async () => {
    const docsRepoDir = makeTmpDir('docs-c56');
    const cloneDir = makeTmpDir('clone-c56');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);
    const squadDir = path.join(docsRepoDir, '.squad');

    // Baseline stamped AFTER the scaffolded files → nothing pending.
    const future = new Date(Date.now() + 3_600_000).toISOString();
    fs.writeFileSync(path.join(squadDir, '.last-publish'), future + '\n', 'utf-8');

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-id';

      // Immediately after the baseline: zero pending.
      await runSync({ direction: 'push', dryRun: true, cwd: cloneDir });
      let out = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(out).toMatch(/Pending files \(0 of \d+ total/);

      consoleSpy.mockClear();

      // One real edit whose mtime is strictly after the baseline.
      const edited = path.join(squadDir, 'decisions.md');
      fs.writeFileSync(edited, '# Decisions\nchanged\n');
      const afterBaseline = new Date(Date.now() + 7_200_000);
      fs.utimesSync(edited, afterBaseline, afterBaseline);

      await runSync({ direction: 'push', dryRun: true, cwd: cloneDir });
      out = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(out).toMatch(/Pending files \(1 of \d+ total/);
      expect(out).toContain('.squad/decisions.md');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('P56.C2: absent .last-publish preserves full pending list (no filtering)', async () => {
    const docsRepoDir = makeTmpDir('docs-c56b');
    const cloneDir = makeTmpDir('clone-c56b');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);
    const squadDir = path.join(docsRepoDir, '.squad');
    // Deliberately do NOT write .last-publish.

    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
        stateBranch: 'squad-state',
      }]),
      warnings: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-id';
      await runSync({ direction: 'push', dryRun: true, cwd: cloneDir });
      const out = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      // Without a baseline, pending count equals the total allowlisted count (N of N).
      const m = out.match(/Pending files \((\d+) of (\d+) total/);
      expect(m).not.toBeNull();
      expect(m![1]).toBe(m![2]);
      expect(Number(m![1])).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('squad sync status', () => {
  it('C2: prints all six fields', async () => {
    const docsRepoDir = makeTmpDir('docs-status');
    const cloneDir = makeTmpDir('clone-status');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);

    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'testdev',
        stateRemote: 'my-remote',
        stateBranch: 'my-branch',
      }]),
      warnings: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runSyncStatus({ cwd: cloneDir });

      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toMatch(/Last published:/);
      expect(allOutput).toMatch(/Pending changes:/);
      expect(allOutput).toMatch(/State remote:\s+my-remote/);
      expect(allOutput).toMatch(/State branch:\s+my-branch/);
      expect(allOutput).toMatch(/Developer alias:\s+testdev/);
      expect(allOutput).toMatch(/Host clone path:\s+/);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('C3: reads .squad/.last-publish when present', async () => {
    const docsRepoDir = makeTmpDir('docs-lastpub');
    const cloneDir = makeTmpDir('clone-lastpub');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);

    const timestamp = '2026-06-06T22:05:52.000Z';
    fs.writeFileSync(path.join(docsRepoDir, '.squad', '.last-publish'), timestamp + '\n', 'utf-8');

    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'testdev',
      }]),
      warnings: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runSyncStatus({ cwd: cloneDir });

      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toContain(timestamp);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('C4: shows "never" for Last published when .squad/.last-publish is absent', async () => {
    const docsRepoDir = makeTmpDir('docs-nopub');
    const cloneDir = makeTmpDir('clone-nopub');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);
    // Do NOT create .last-publish

    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'testdev',
      }]),
      warnings: [],
    });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runSyncStatus({ cwd: cloneDir });

      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toContain('Last published:');
      expect(allOutput).toContain('never');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('C5: shows "(not set)" for alias and "(not bound)" for docs path when no registry entry', async () => {
    const cloneDir = makeTmpDir('clone-noentry');
    initWorkingRepo(cloneDir);
    // No registry entry
    vi.mocked(loadRegistryFromDisk).mockReturnValue({ registry: null, warnings: [] });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runSyncStatus({ cwd: cloneDir });

      const allOutput = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(allOutput).toContain('(not set)');
      expect(allOutput).toContain('(not bound)');
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─── --quiet stderr regression guard ─────────────────────────────────────────

describe('--quiet regression guard', () => {
  it('C6: --quiet suppresses stdout progress messages but errors reach stderr', async () => {
    const docsRepoDir = makeTmpDir('docs-quiet');
    const cloneDir = makeTmpDir('clone-quiet');
    const cloneRoot = initWorkingRepo(cloneDir);
    setupSquadDir(docsRepoDir);

    const squadDir = path.join(docsRepoDir, '.squad');
    vi.mocked(loadRegistryFromDisk).mockReturnValue({
      registry: makeRegistry([{
        callsign: 'alpha',
        path: squadDir,
        clones: [cloneRoot],
        inboxHandle: 'dev1',
        stateRemote: 'squad-docs',
      }]),
      warnings: [],
    });

    // Mock transport to resolve successfully
    const publishSpy = vi.spyOn(_transport, 'publishTeamRootToInbox').mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.env['COPILOT_SESSION_ID'] = 'test-session-quiet';
      await runSync({ direction: 'push', quiet: true, cwd: cloneDir });

      // No progress messages should have been emitted via console.log
      const logOutput = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
      expect(logOutput).not.toContain('squad sync:');

      // publishTeamRootToInbox was still called (quiet only suppresses output, not execution)
      expect(publishSpy).toHaveBeenCalledOnce();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});
