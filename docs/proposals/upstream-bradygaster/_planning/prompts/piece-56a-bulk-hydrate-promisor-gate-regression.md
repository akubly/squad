@Lead and Team, this is a Phase B **bugfix** replay session — a stacked follow-up to piece 56.
Phase A staged the bug spec `56a-bulk-hydrate-promisor-gate-regression.md` on the
`akubly/upstream-specs` branch. Phase B implements the fix on its own branch, fully tested. No PR
creation in Phase B.

**UPDATE (2026-07-23): 56a-v1 was built and dogfooded — the promisor-gate fix works but is NOT enough.**
A preview.20 pack carrying your gate fix was ingested and cold-started live: the gate now fires
correctly, but the cold-start is **still ~41 minutes**. §B has a **second, independent defect** the gate
fix exposed. Continue on the **same** `squad/piece-56a-bulk-hydrate-promisor-gate-regression` branch and
add the second fix — do not open a new branch/piece. The spec now has an **"Amendment (2026-07-23)"**
section at the top with the full diagnosis, empirical evidence, and the exact fix; read it first.

**Second defect in one paragraph:** After §B's gate correctly decides `isPartialClone = true`, its bulk
`git fetch --no-filter <remote> <refspec>` is a **no-op**, because an earlier step already fetched that
ref with the blob:none filter. Git sees the commit is already present, reports "up-to-date", and
downloads **zero blobs** — `--no-filter` does not retroactively backfill blobs on an already-present
ref. The `cat-file` write-out then lazily promisor-fetches every blob individually (inside the cat-file
subprocess, invisible to the exec-count unit test) = O(files). **Fix: add `--refetch`** →
`git fetch --refetch --no-filter <remote> <refspec>`, which ignores negotiation and backfills all lane
blobs in one transfer. Empirically verified: plain `--no-filter` re-fetch of the same ref = 0 blobs;
`--refetch --no-filter` = 1055 blobs in ~2 s; live cold-start dropped 2482 s → 305 s with zero cycling
git children.

This is NOT a new stack piece. It corrects **piece 56 sub-proposal B (decision G1)**, which shipped but
silently no-ops on the real managed cold-start path. Piece 56's other sub-proposals (A cwd-bind, C
honest publish baseline, D host-clone doctor) were verified green on a live preview.19 pilot; only §B
regressed. A live cold-start of a ~1,600-file squad still took **~41 minutes** (O(N) per-file promisor
fetches) instead of the O(1)-per-lane bulk transfer §B promised.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-56a-bulk-hydrate-promisor-gate-regression`
  off `squad/piece-56-managed-cold-start-hardening-and-fold-ref-garbage-collection` (its tip).
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of the clone.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs
into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56-managed-cold-start-hardening-and-fold-ref-garbage-collection.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/56a-bulk-hydrate-promisor-gate-regression.md
```

If `56a-bulk-hydrate-promisor-gate-regression.md` does not exist on `akubly/upstream-specs`, STOP
immediately and post a blocking comment asking the spec to be staged first.

## The defect in one paragraph

`hydrateTeamRootFromRef` (`packages/squad-cli/src/cli/commands/sync.ts`) gates its §B bulk
`git fetch --no-filter` on `git config --get remote.${remote}.promisor === 'true'`. But `assign` calls
the hydrate with `remote` = the state/config **URL** (`effectiveStateRemote`), while the blobless clone
records the promisor flag under the remote **name** (`remote.origin.promisor=true`). So the config
lookup misses, `isPartialClone` is false, the bulk fetch is skipped, and Step 4's `cat-file blob` loop
falls back to per-blob promisor fetches = O(files) network round-trips. The §B unit test passed only
because its fixture stores and reads the promisor flag under the same token — a calling convention no
real caller uses.

## Verify-first, then fix (see 56a spec for full detail)

1. Confirm the gate and that `remote` is threaded as a URL from `assign`. Confirm the surrounding
   `.last-hydrate-sha` fast-path and monorepo `resolveTeamRootGitDir` handling stay unchanged.
2. Fix (BOTH halves): (a) detect the partial clone **remote-agnostically** — scan `git config
   --get-regexp '^remote\..*\.promisor$'` for any `true` (a managed clone has exactly one remote; a full
   clone has none, so non-managed `--pull` stays byte-identical). (b) Make the bulk fetch actually
   backfill blobs by adding `--refetch`: `git fetch --refetch --no-filter <remote> <refspec>` — without
   it the fetch no-ops on the already-present ref. Preserve decision G's O(1)-per-lane guarantee and the
   fast-path skip ordering.
3. **Test (the part CI missed, both layers):** the §B regression test must (a) build the fixture so the
   promisor flag lives under the remote NAME as real `git clone --filter` does, (b) drive the hydrate
   with a remote token that is NOT the configured name (a URL), (c) assert the count of network-touching
   git invocations is independent of file count, AND (d) assert the **local object store is fully
   blob-populated after §B's bulk fetch** (e.g. `git cat-file --batch-all-objects --batch-check`), so the
   cat-file write-out issues zero lazy fetches. An exec-call-count assertion alone is blind to the no-op
   re-fetch — the per-blob fetches happen inside the cat-file subprocess. This test must fail on today's
   code and pass after both fixes.

## Deliverables

- The fix in `sync.ts`, minimal and surgical (remote-agnostic gate **and** `--refetch` on the bulk
  fetch).
- The strengthened §B regression test proving O(1)-per-lane on the URL-remote path AND asserting the
  local blob store is fully populated after the bulk fetch (cat-file write-out does zero network fetches).
- A `patch` changeset for `@bradygaster/squad-cli`.
- Triage note recording BOTH decision-G refinements (name-keyed → remote-agnostic promisor detection;
  bulk fetch → `--refetch` to backfill blobs on an already-present ref) and the CI fidelity gap that hid
  them (exec-call count is blind to per-blob lazy fetches inside cat-file).
- No fold-template edits; §F stays byte-identical. Do not regress warm-assign, monorepo-host hydrate, or
  hydrate idempotency.

Full acceptance criteria are in the 56a spec. When green and committed on the stacked branch, stop —
Phase C (the upstream PR) is a later, separate session.
