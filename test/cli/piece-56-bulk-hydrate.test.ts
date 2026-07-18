/**
 * Piece 56 §B — bulk managed hydrate.
 *
 * On a managed `--filter=blob:none` clone the per-file `cat-file blob` write-out loop would
 * otherwise lazily promisor-fetch every file individually (O(files) network round trips). §B
 * inserts a single unfiltered `git fetch` of the resolved ref tip before the write-out loop so
 * every reachable blob lands in one pack, gated to partial clones and placed after the
 * `.last-hydrate-sha` sentinel fast-path.
 *
 * These tests drive the injectable `_hydrateGit` git-exec seam to MECHANICALLY assert the
 * network-touching call count is O(1) per lane — independent of the number of files — rather
 * than eyeballing "looks right".
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  hydrateTeamRootFromStateRef,
  _hydrateGit,
} from '../../packages/squad-cli/src/cli/commands/sync.js';

const TMP_ROOT = path.join(process.cwd(), 'test', '.p56-bulk-hydrate-tmp');
const FIXTURE_DIRS: string[] = [];

function makeTmpDir(label: string): string {
  const dir = path.join(TMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  FIXTURE_DIRS.push(dir);
  return dir;
}

function bareUrl(bare: string): string {
  return 'file:///' + bare.replace(/\\/g, '/');
}

/** Seed a bare repo with an orphan `branch` holding `fileCount` `.squad/` files. */
function seedOrphanBranch(base: string, branch: string, fileCount: number): string {
  const bare = path.join(base, 'bare.git');
  fs.mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });

  const seed = path.join(base, 'seed');
  fs.mkdirSync(seed, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', seed], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['checkout', '--orphan', branch], { cwd: seed, stdio: 'pipe' });

  fs.mkdirSync(path.join(seed, '.squad'), { recursive: true });
  for (let i = 1; i <= fileCount; i++) {
    fs.writeFileSync(path.join(seed, '.squad', `file${i}.md`), `content-${i}-${'x'.repeat(128)}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'seed state'], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: seed, stdio: 'pipe' });
  execFileSync('git', ['push', 'origin', branch], { cwd: seed, stdio: 'pipe' });
  return bare;
}

/** A blobless, no-checkout clone of `bare` — the shape of a managed consumer host. */
function bloblessClone(bare: string, dest: string): void {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', bareUrl(bare), dest], { stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dest, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dest, stdio: 'pipe' });
}

function countCalls(spy: ReturnType<typeof vi.spyOn>, needle: string): number {
  return spy.mock.calls.filter(c => Array.isArray(c[0]) && (c[0] as string[]).includes(needle)).length;
}

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of FIXTURE_DIRS.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('piece 56 §B — bulk managed hydrate', { timeout: 90_000 }, () => {
  it('P56.B1: network fetch count is O(1) per lane, independent of file count', async () => {
    const branch = 'squad-state';

    // ── Lane with FEW files ──────────────────────────────────────────────────
    const baseSmall = makeTmpDir('small');
    const bareSmall = seedOrphanBranch(baseSmall, branch, 3);
    const hostSmall = path.join(baseSmall, 'host');
    bloblessClone(bareSmall, hostSmall);

    const spySmall = vi.spyOn(_hydrateGit, 'exec');
    await hydrateTeamRootFromStateRef(hostSmall, 'origin', branch);
    const fetchSmall = countCalls(spySmall, 'fetch');
    const catFileSmall = countCalls(spySmall, 'cat-file');
    const bulkSmall = countCalls(spySmall, '--no-filter');
    spySmall.mockRestore();

    // ── Lane with MANY MORE files ────────────────────────────────────────────
    const baseBig = makeTmpDir('big');
    const bareBig = seedOrphanBranch(baseBig, branch, 12);
    const hostBig = path.join(baseBig, 'host');
    bloblessClone(bareBig, hostBig);

    const spyBig = vi.spyOn(_hydrateGit, 'exec');
    await hydrateTeamRootFromStateRef(hostBig, 'origin', branch);
    const fetchBig = countCalls(spyBig, 'fetch');
    const catFileBig = countCalls(spyBig, 'cat-file');
    const bulkBig = countCalls(spyBig, '--no-filter');
    spyBig.mockRestore();

    // The bulk unfiltered pre-fetch fires exactly once per lane on a partial clone.
    expect(bulkSmall).toBe(1);
    expect(bulkBig).toBe(1);

    // Network-touching (`fetch`) calls do NOT scale with file count — the whole point of §B.
    expect(fetchBig).toBe(fetchSmall);

    // Local reads (`cat-file`) DO scale with file count — proving the loop still runs O(files)
    // but only against local objects, so the network stayed O(1).
    expect(catFileSmall).toBe(3);
    expect(catFileBig).toBe(12);
    expect(catFileBig).toBeGreaterThan(catFileSmall);

    // Correctness: every blob materialised into the host team root.
    for (let i = 1; i <= 12; i++) {
      const p = path.join(hostBig, '.squad', `file${i}.md`);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf-8')).toBe(`content-${i}-${'x'.repeat(128)}\n`);
    }
  });

  it('P56.B2: unchanged-tip re-pull is a no-op — never re-issues the bulk fetch', async () => {
    const branch = 'squad-state';
    const base = makeTmpDir('reissue');
    const bare = seedOrphanBranch(base, branch, 5);
    const host = path.join(base, 'host');
    bloblessClone(bare, host);

    // First hydrate populates the sentinel and issues the bulk fetch once.
    await hydrateTeamRootFromStateRef(host, 'origin', branch);
    expect(fs.existsSync(path.join(host, '.squad', '.last-hydrate-sha'))).toBe(true);

    // Second hydrate against the same tip must short-circuit at the sentinel — BEFORE the bulk
    // fetch — so the expensive unfiltered fetch is never re-issued.
    const spy = vi.spyOn(_hydrateGit, 'exec');
    await hydrateTeamRootFromStateRef(host, 'origin', branch);
    expect(countCalls(spy, '--no-filter')).toBe(0);
    expect(countCalls(spy, 'cat-file')).toBe(0);
    spy.mockRestore();
  });
});
