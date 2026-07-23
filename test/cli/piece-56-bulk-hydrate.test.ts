/**
 * Piece 56 §B — bulk managed hydrate (and its 56a regression hardening).
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
 *
 * 56a — fidelity hardening: `git clone --filter=blob:none` records the partial-clone promisor
 * flag under the clone's own remote NAME (`origin`). But real callers (`assign`) thread the
 * hydrate `remote` as a resolved remote token that is NOT that name — the config lane drives the
 * hydrate with its own `squad-config` remote registered for the config URL — which is NEVER the
 * clone's `origin`. A promisor lookup keyed on that token therefore misses, the bulk fetch is
 * silently skipped, and the O(files) fallback returns. The `P56.B1u` case below reproduces that
 * exact production calling convention (flag under `origin`, hydrate driven by a *different* remote
 * token) so the gate is exercised the way the managed cold-start actually drives it — the fidelity
 * gap the original name-matched fixture hid. Because the fix keys off the *presence* of any
 * promisor remote rather than the token, driving with a distinct remote NAME is a faithful stand-in
 * regardless of whether a caller threads a name or a URL.
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

/**
 * A blobless, no-checkout clone of `bare` — the shape of a managed consumer host.
 * `git clone --filter=blob:none` records `remote.origin.promisor=true` /
 * `remote.origin.partialclonefilter=blob:none` under the remote NAME `origin`.
 */
function bloblessClone(bare: string, dest: string): void {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', bareUrl(bare), dest], { stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dest, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dest, stdio: 'pipe' });
}

/**
 * A full (non-partial) clone of `bare` — no `--filter`, so git records NO `remote.*.promisor`
 * flag. The remote-agnostic scan must find nothing, `isPartialClone` stays false, and the bulk
 * `--no-filter` pre-fetch is skipped — keeping the non-managed `--pull` path byte-identical
 * (zero extra network). All blobs are already local, so the write-out loop reads them directly.
 */
function fullClone(bare: string, dest: string): void {
  execFileSync('git', ['clone', '--no-checkout', bareUrl(bare), dest], { stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.email', 'test@squad.test'], { cwd: dest, stdio: 'pipe' });
  execFileSync('git', ['config', '--local', 'user.name', 'Squad Test'], { cwd: dest, stdio: 'pipe' });
}

/**
 * Register a SECOND remote (distinct from the clone's promisor `origin`) pointing at the same
 * bare repo, exactly as `assign` registers `squad-config` for a config lane on its own remote.
 * This remote carries NO promisor flag, so a promisor lookup keyed on this token misses.
 * Returns the token a real caller would thread to the hydrate (the remote NAME).
 */
function addStateRemote(host: string, bare: string, name: string): string {
  execFileSync('git', ['remote', 'add', name, bareUrl(bare)], { cwd: host, stdio: 'pipe' });
  return name;
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

describe('piece 56 §B — bulk managed hydrate', { timeout: 120_000 }, () => {
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

  it('P56.B1u (56a regression): fires the bulk fetch on the PRODUCTION calling convention — a hydrate remote token that is NOT the clone promisor remote name', async () => {
    const branch = 'squad-state';
    // `assign` threads the config lane's own remote token (`squad-config`), never the clone's
    // `origin` under which `--filter=blob:none` recorded the promisor flag. A promisor lookup keyed
    // on that token misses; only a remote-agnostic detection still recognises the partial clone.
    const DRIVE_REMOTE = 'squad-config';

    // ── Lane with FEW files ──────────────────────────────────────────────────
    const baseSmall = makeTmpDir('few');
    const bareSmall = seedOrphanBranch(baseSmall, branch, 5);
    const hostSmall = path.join(baseSmall, 'host');
    bloblessClone(bareSmall, hostSmall);
    const tokenSmall = addStateRemote(hostSmall, bareSmall, DRIVE_REMOTE);

    // Sanity: the promisor flag lives under `origin`, NOT under the driving token — exactly the
    // production shape the original name-matched fixture never exercised.
    expect(
      execFileSync('git', ['config', '--get', 'remote.origin.promisor'], { cwd: hostSmall, encoding: 'utf-8' }).trim(),
    ).toBe('true');
    let tokenPromisor = '';
    try {
      tokenPromisor = execFileSync('git', ['config', '--get', `remote.${tokenSmall}.promisor`], { cwd: hostSmall, encoding: 'utf-8' }).trim();
    } catch { /* unset — exit 1 — the exact miss the old gate hit */ }
    expect(tokenPromisor).toBe('');

    const spySmall = vi.spyOn(_hydrateGit, 'exec');
    await hydrateTeamRootFromStateRef(hostSmall, tokenSmall, branch);
    const bulkSmall = countCalls(spySmall, '--no-filter');
    const catFileSmall = countCalls(spySmall, 'cat-file');
    spySmall.mockRestore();

    // The fix: the bulk unfiltered fetch fires exactly ONCE even though the hydrate is driven by a
    // non-promisor-named remote token. On the pre-fix name-keyed gate (`remote.${remote}.promisor`)
    // this is 0 — the lookup on `squad-config` misses and §B is silently skipped, restoring the
    // O(files) per-blob promisor fallback. This assertion is the regression trap the original
    // name-matched fixture (which drove the hydrate with the same `origin` token it stored the flag
    // under) could never trip. File-count independence of the network cost is proven at true scale
    // (5 vs 1,500) in P56.B1s below, via the exec seam this suite is built around.
    expect(bulkSmall).toBe(1);
    expect(catFileSmall).toBe(5);

    // Correctness: every blob materialised into the host team root on the distinct-remote path.
    for (let i = 1; i <= 5; i++) {
      const p = path.join(hostSmall, '.squad', `file${i}.md`);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf-8')).toBe(`content-${i}-${'x'.repeat(128)}\n`);
    }
  });

  it('P56.B1s (56a regression): network-touching git invocation count is O(1) per lane — identical for 5 files and for 1,500 — on the non-promisor-named remote token', async () => {
    // The `_hydrateGit` seam exists (see its docstring in sync.ts) to MECHANICALLY assert the
    // network cost of §B is independent of file count without paying for N real `cat-file` spawns.
    // Here the seam simulates a partial clone whose promisor flag lives under `origin` while the
    // hydrate is driven by a DIFFERENT token (`squad-config`) — the production convention — and a
    // tree of N files, then counts the network-touching (`fetch`) invocations for N = 5 and 1,500.
    const branch = 'squad-state';
    const DRIVE_REMOTE = 'squad-config';

    async function networkFetchCountFor(fileCount: number): Promise<{ fetch: number; bulk: number; catFile: number }> {
      const teamRoot = makeTmpDir(`scale-${fileCount}`);
      // A real (tiny) repo so the non-seamed `resolveTeamRootGitDir` (`git rev-parse
      // --absolute-git-dir`) resolves; the tree contents themselves come from the seam.
      execFileSync('git', ['init', '-b', 'main', teamRoot], { stdio: 'pipe' });
      const treeList = Array.from({ length: fileCount }, (_, i) => `.squad/file${i + 1}.md`).join('\n');

      const spy = vi.spyOn(_hydrateGit, 'exec').mockImplementation((args: string[], opts: Record<string, unknown>) => {
        // Partial-clone signal: flag lives under `origin`, NOT under the driving token.
        if (args.includes('--get-regexp')) return 'remote.origin.promisor true\n';
        if (args.includes('ls-tree')) return treeList;
        if (args.includes('cat-file')) return Buffer.from('blob-body\n');
        if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
        // Both the Step-1 fetch and the §B bulk `--no-filter` fetch land here.
        if (args[0] === 'fetch') return '';
        return (opts && opts['encoding'] === null) ? Buffer.alloc(0) : '';
      });

      await hydrateTeamRootFromStateRef(teamRoot, DRIVE_REMOTE, branch);
      const result = {
        fetch: countCalls(spy, 'fetch'),
        bulk: countCalls(spy, '--no-filter'),
        catFile: countCalls(spy, 'cat-file'),
      };
      spy.mockRestore();
      return result;
    }

    const few = await networkFetchCountFor(5);
    const many = await networkFetchCountFor(1500);

    // Network-touching invocations are O(1) per lane — a single Step-1 fetch plus a single bulk
    // `--no-filter` fetch — and do NOT grow with the file count.
    expect(few.bulk).toBe(1);
    expect(many.bulk).toBe(1);
    expect(many.fetch).toBe(few.fetch);
    expect(few.fetch).toBe(2);

    // The local `cat-file` write-out loop is the ONLY thing that scales with file count.
    expect(few.catFile).toBe(5);
    expect(many.catFile).toBe(1500);
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

  it('P56.B3 (56a guard): a full (non-partial) clone issues ZERO bulk fetch — non-managed --pull stays byte-identical', async () => {
    const branch = 'squad-state';
    const base = makeTmpDir('fullclone');
    const bare = seedOrphanBranch(base, branch, 5);
    const host = path.join(base, 'host');
    fullClone(bare, host);

    // A full clone records no promisor remote, so the remote-agnostic scan must find nothing —
    // `git config --get-regexp '^remote\..*\.promisor$'` exits 1 with empty output.
    let promisorScan = '';
    try {
      promisorScan = execFileSync('git', ['config', '--get-regexp', '^remote\\..*\\.promisor$'], { cwd: host, encoding: 'utf-8' }).trim();
    } catch { /* exit 1 — no promisor remote, exactly as expected for a full clone */ }
    expect(promisorScan).toBe('');

    const spy = vi.spyOn(_hydrateGit, 'exec');
    await hydrateTeamRootFromStateRef(host, 'origin', branch);
    // No partial clone ⇒ the §B bulk unfiltered pre-fetch never fires. This locks the decision-G
    // invariant that G1 must not add network to the shared non-managed hydrate path.
    expect(countCalls(spy, '--no-filter')).toBe(0);
    spy.mockRestore();

    // Correctness: the blobs (already local in a full clone) still materialise into the team root.
    for (let i = 1; i <= 5; i++) {
      const p = path.join(host, '.squad', `file${i}.md`);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf-8')).toBe(`content-${i}-${'x'.repeat(128)}\n`);
    }
  });
});
