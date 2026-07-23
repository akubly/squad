# 56a — Bugfix: piece-56 §B bulk hydrate silently no-ops on managed cold-start

## Summary

Piece 56 §B (decision G1) set out to eliminate the O(N) per-file promisor fetch on a managed
cold-start by materializing a lane's blobs in **one** `git fetch --no-filter` before the
`cat-file blob` write-out loop, so the hydrate issues **O(1) network round-trips per lane** instead of
O(files). The code landed in `hydrateTeamRootFromRef` (`packages/squad-cli/src/cli/commands/sync.ts`)
and its unit test passes.

**But on the real managed cold-start path §B never fires.** A live preview.19 pilot cold-start of a
~1,600-file squad still took **2482 s (~41 min)**, with a `git-remote-https` fetch per file — exactly
the O(N) behavior §B was written to remove. The bulk fetch is gated on the wrong signal, and the §B
regression test does not exercise the calling convention the production path actually uses, so the gap
is invisible to CI. Piece 56 is otherwise sound — §A (cwd-bind), §C (honest publish baseline: verified
`sync --dry-run` = 0 of 1096 pending), and §D (host-clone `doctor` = 13 passed, 0 errors) all verified
green on the same pilot. This is a single-defect follow-up to make §B's promise actually hold.

Stack position: a bugfix stacked on the piece-56 tip
(`squad/piece-56-managed-cold-start-hardening-and-fold-ref-garbage-collection`). Not a new stack piece —
it corrects §B / decision G within piece 56 before Phase C PRs.

---

## Amendment (2026-07-23): §B has a SECOND defect — the promisor gate fix is necessary but insufficient

The first build of 56a landed the remote-agnostic promisor gate (below) and was ingested into a
preview.20 dogfood pack. **Result: the gate now fires correctly, but the live managed cold-start is
STILL ~41 minutes.** §B has two independent bugs; 56a-v1 fixed only the first.

**Second defect — the bulk `fetch --no-filter` is a silent no-op on an already-present ref.**
`hydrateTeamRootFromRef` fetches the lane's ref in an earlier step with a *filtered* fetch
(`git fetch origin <refspec>` under the blob:none partial-clone config — pulls the commit + trees, **no
blobs**). §B then runs `git fetch --no-filter <remote> <same-refspec>`. Because the ref's commit object
is **already present** from the earlier fetch, git's negotiation reports "up-to-date" and downloads
**nothing** — the `--no-filter` flag has no effect when there is no new *commit* to fetch; it does not
retroactively backfill blobs git already decided to skip. The blobs are never materialized, so Step 4's
`cat-file blob` write-out loop falls back to per-blob promisor fetches (issued *inside* the `cat-file`
subprocess) = O(files). O(N) restored, exactly as with the gate bug — just one layer deeper.

**Empirical confirmation (real `akubly_microsoft/squads`, isolated blobless clone):**

| Step | local blob count | wall |
| --- | --- | --- |
| `git clone --filter=blob:none` | 0 | — |
| filtered `git fetch origin <refspec>` (Step 1) | **0** | ~1 s |
| `git fetch --no-filter origin <same-refspec>` (§B today) | **0** ← no-op | ~1 s |
| `git fetch --refetch --no-filter origin <same-refspec>` (fix) | **1055** ← backfilled | ~2 s |

**The fix: add `--refetch` to the §B bulk fetch.** `git fetch --refetch` tells git to ignore what it
already has and re-fetch all reachable objects under the *current* (now `--no-filter`) filter, which
backfills exactly the blobs the earlier filtered fetch skipped — in one O(1)-per-lane transfer:

```ts
// §B bulk hydrate — was: ['fetch', '--no-filter', remote, refspec]
gitExec(['fetch', '--refetch', '--no-filter', remote, refspec]);
```

**End-to-end proof (live isolated managed cold-start, preview.20 dist patched with `--refetch`):**
`ELAPSED: 305 s` vs `2482 s` unpatched — and **zero cycling `git-remote-https` child processes** (the
O(N) signature is gone; all blobs arrive in one bulk transfer). The residual ~5 min is fixed upgrade
overhead (skill migration + Copilot payload refresh + npm), not hydrate — independent of file count.

**Why the §B unit test passed through BOTH bugs.** The test counts explicit `exec(['fetch', …])`
invocations via a spy and asserts that count is file-count-independent. But the O(N) cost is the
per-blob lazy promisor fetch that git performs *internally, inside the `cat-file` subprocess* — invisible
to the exec spy. So the test passes whether blobs arrive via the bulk fetch OR via hidden per-blob
fetches; with a tiny local `file://` fixture the lazy path is instant, so the test is fast AND green
while measuring the wrong thing. **The test must assert the actual local blob population after the bulk
fetch** (see strengthened Test requirement below), not just the exec call count.

The remote-agnostic gate fix (original 56a body, below) is still required — without it the bulk fetch
never fires at all. Land **both** fixes together on the same 56a branch.

---

## Root cause

The managed host clone is created blobless
(`git clone --filter=blob:none --no-checkout`). Git records the partial-clone promisor flag under the
**remote name**:

```
remote.origin.promisor = true
remote.origin.partialclonefilter = blob:none
```

`hydrateTeamRootFromRef(teamRoot, remote, branch, …)` receives `remote` as the **state/config remote
URL** — `assign` calls it with `effectiveStateRemote` (e.g. `https://…/<repo>`), not the literal
remote name `origin` (see `assign.ts` — `hydrateStateFn(managedProjectDir, effectiveStateRemote,
effectiveStateBranch)`). §B then decides whether to bulk-fetch with:

```ts
const promisor = git(['config', '--get', `remote.${remote}.promisor`]);   // remote === the URL
isPartialClone = (promisor === 'true');
```

`git config --get remote.https://…/<repo>.promisor` matches nothing (the flag lives under
`remote.origin.*`, and a URL is not a configured remote name) → returns empty, exit 1 →
`isPartialClone = false` → the `fetch --no-filter` is **skipped** → Step 4's `cat-file blob` loop falls
straight back to per-blob promisor fetches. O(N) restored.

Note: `extensions.partialclone` is **not** reliably set on these clones either (empty on the pilot
host), so keying off that alone is insufficient. The durable signals present on every blobless clone are
the per-remote `promisor` / `partialclonefilter` entries.

## Evidence (preview.19 live pilot, isolated `SQUAD_HOME`/`SQUAD_REGISTRY_PATH`)

- Managed cold-start of a real ~1,600-file squad: **`ELAPSED: 2482s`**; hosts dir grew ~35 files/min
  with a `git-remote-https` child per file — the O(N) signature.
- On the resulting managed clone: `git config --get-regexp '^remote\.'` →
  `remote.origin.promisor true`, `remote.origin.partialclonefilter blob:none`; but
  `git config --get remote.<state-remote-url>.promisor` → **empty, exit 1** (the exact gate §B
  evaluates). Confirms the bulk fetch is skipped on this path.
- Same build, same pilot: §C `sync --dry-run` = **0 of 1096 pending** (honest baseline works); §D
  host-clone `doctor` = **13 passed, 0 errors** (no false "folding disabled"). So §B is the sole
  cold-start regression.

## Verify-first (before changing anything)

- Confirm `hydrateTeamRootFromRef`'s §B block still gates the `fetch --no-filter` on
  `remote.${remote}.promisor`, and that `remote` is the value threaded from `assign`'s
  `effectiveStateRemote` / `effectiveConfigRemote` (a URL), not `'origin'`. Confirm the monorepo
  `resolveTeamRootGitDir` / `--absolute-git-dir` handling and the `.last-hydrate-sha` /
  `.last-config-hydrate-sha` fast-path skip are unchanged around it.
- Confirm the existing §B regression test's fixture: how it sets `remote.<x>.promisor` and what `remote`
  token it passes to the hydrate. The bug is that the fixture almost certainly sets the flag under the
  **same** token it passes (so the gate matches), which no real caller does.

## Sub-proposal (Tier 1) — detect the partial clone remote-agnostically

Replace the name-keyed promisor lookup with a check that does not depend on the caller passing a
configured remote **name**. Preferred shape:

- Scan for any promisor remote: `git config --get-regexp '^remote\..*\.promisor$'` and treat
  `isPartialClone = true` if any value is `true`. (A managed clone has exactly one remote; a full clone
  has none, so non-managed `--pull` stays byte-identical — no extra network — preserving decision G's
  constraint.)
- Then issue the bulk `git fetch --no-filter <remote> <refspec>` exactly as today. Passing the URL to
  `fetch` is fine — `git fetch` accepts a URL; only the *config lookup* was name-sensitive.
- Keep the fast-path skip ordering (§B stays **after** the `.last-hydrate-sha` sentinel check so an
  unchanged-tip re-pull issues zero bulk fetches).

Either alternative is acceptable if it yields O(1) network round-trips per lane on the real
`assign`-driven cold-start: (a) resolve the URL to its configured remote name first, then reuse the
existing gate; or (b) drop `--filter=blob:none` from the managed clone entirely (decision G3) since the
consumer fully hydrates both lanes anyway — but (b) is a larger behavior change than this bugfix
intends.

## Test requirement (this is the part CI missed)

The §B regression test must reproduce the **production calling convention**, not a convenient one:

1. Build the fixture partial clone so the promisor flag is stored under the remote **name** (`origin`),
   exactly as `git clone --filter=blob:none` does.
2. Drive the hydrate the way `assign` does — pass the remote as a **URL / a token that is not the
   configured remote name**.
3. Assert the number of network-touching git invocations (bulk `fetch` + `cat-file blob` fetches) is
   **independent of file count** — i.e. exactly one blob-materializing fetch per lane regardless of
   whether the team root has 5 files or 1,500. Inject the git-exec seam and count calls (as the original
   §B test intended).

A test written to (1)+(2) fails on today's code (the gate misses) and passes once the fix lands —
proving the fix, and permanently closing the fidelity gap.

4. **Assert actual blob materialization, not just fetch-call count** (closes the second-defect gap). An
   exec-invocation counter cannot see the per-blob promisor fetches git performs *inside* the `cat-file`
   subprocess, so it is blind to the no-op re-fetch. The test must therefore assert the **local object
   store is fully populated after §B's bulk fetch and before the `cat-file` write-out loop** — e.g. count
   blob objects via `git cat-file --batch-all-objects --batch-check` (expect all lane blobs present), or
   assert the `cat-file` write-out performs **zero** network fetches (no promisor child processes / no
   growth in fetched-pack count). On today's code the bulk fetch is a no-op so the blob count stays 0
   (or the write-out triggers N lazy fetches); after adding `--refetch` the blobs are all present and the
   write-out is purely local. Prefer a real `--filter=blob:none` clone with a distinct remote **name** vs
   the URL/token passed to the hydrate, so BOTH defects (gate miss + no-op re-fetch) are exercised by one
   test.

## Changeset requirement

`packages/squad-cli/src/` is touched (`sync.ts` hydrate gate **and** the §B bulk-fetch line). Include a
`patch` changeset for `@bradygaster/squad-cli`. No fold-template changes; §F stays byte-identical. Record
in triage BOTH decision-G refinements: (1) name-keyed → remote-agnostic promisor detection, and (2)
adding `--refetch` so the bulk fetch backfills blobs on an already-present ref instead of no-oping.

## Acceptance

- The §B regression test exercises the URL-remote calling convention AND asserts the local object store
  is fully blob-populated after §B's bulk fetch (the `cat-file` write-out issues zero network fetches).
  The test fails on today's code (gate miss and/or no-op re-fetch) and passes with both fixes.
- A live (or seam-driven equivalent) managed cold-start issues one blob-materializing fetch per lane;
  wall-clock for the hydrate is independent of file count (seconds, not tens of minutes) with no
  per-blob `git-remote-https` child processes. Verified: `--refetch` drops a real ~1,600-file cold-start
  from 2482 s to 305 s with zero cycling git children.
- No regression to the warm-assign path, the monorepo-host hydrate, or the `.last-hydrate-sha` /
  `.last-config-hydrate-sha` fast-path idempotency.
