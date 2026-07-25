# Piece 56a — Bugfix Triage: §B bulk hydrate promisor-gate regression

Replay Phase B (bugfix), stacked feature branch
`squad/piece-56a-bulk-hydrate-promisor-gate-regression`, off the piece-56 tip
`squad/piece-56-managed-cold-start-hardening-and-fold-ref-garbage-collection`.
Fork-internal `.squad/` state (stripped by Phase C). Recorded after the verify-first
pass confirmed the defect against the piece-56 tip.

This corrects **piece-56 sub-proposal B (decision G1)** only. Piece 56's other
sub-proposals — A (cwd-bind), C (honest publish baseline), D (host-clone doctor),
E/F — were verified green on the preview.19 pilot and are untouched here. §F fold
templates stay byte-identical.

---

## The defect

`hydrateTeamRootFromRef` (`packages/squad-cli/src/cli/commands/sync.ts`) gated its §B
bulk `git fetch --no-filter` on:

```ts
const promisor = git(['config', '--get', `remote.${remote}.promisor`]);
isPartialClone = (promisor === 'true');
```

The managed host clone is created blobless (`git clone --filter=blob:none
--no-checkout`), which records the partial-clone flag under the clone's own remote
**name**:

```
remote.origin.promisor = true
remote.origin.partialclonefilter = blob:none
```

But `assign` threads the hydrate `remote` argument as a *resolved remote token that is
not the clone's promisor remote name* — the config lane drives the hydrate with its own
`squad-config` remote, registered for the config URL — never the literal clone remote
name `origin` under which `--filter=blob:none` recorded the promisor flag. (The
preview.19 pilot state lane likewise presented a token for which
`git config --get remote.<token>.promisor` returned empty, exit 1.) So the name-keyed
lookup matched nothing (exit 1) → `isPartialClone = false` → the bulk fetch was
**skipped** → Step 4's `cat-file blob` loop fell back to per-blob promisor fetches:
O(files) network round-trips. A live preview.19 cold-start of a ~1,600-file squad took
~41 min (`ELAPSED: 2482s`) instead of the O(1)-per-lane bulk transfer §B promised.

---

## Decision G refinement — name-keyed → remote-agnostic promisor detection

**Refined: keep G1 (bulk unfiltered `git fetch` before the local write-out loop),
but detect the partial clone remote-agnostically instead of by the caller's token.**

```ts
const promisorRemotes = git(['config', '--get-regexp', '^remote\\..*\\.promisor$']);
isPartialClone = promisorRemotes.split('\n')
  .some(line => line.trim().split(/\s+/).pop() === 'true');
```

### Rationale
- **A managed clone has exactly one promisor remote; a full clone has none.** Scanning
  for *any* `promisor = true` recognizes the partial clone no matter which token
  (`origin`, a URL, or `squad-config`) the caller threads to the hydrate. This is the
  durable signal present on every blobless clone — unlike `extensions.partialclone`,
  which the pilot host left empty.
- **Non-managed `--pull` stays byte-identical.** A full clone has no promisor remote,
  so the scan yields nothing, `isPartialClone` stays false, and no extra network is
  issued — preserving decision G's constraint that G1 must not alter the shared
  non-managed hydrate path.
- **Decision G1's O(1)-per-lane guarantee is preserved.** The bulk
  `fetch --no-filter <remote> <refspec>` runs exactly as before; passing a URL to
  `git fetch` is fine — only the *config lookup* was name-sensitive. The §B block stays
  **after** the `.last-hydrate-sha` / `.last-config-hydrate-sha` sentinel fast-path, so
  an unchanged-tip re-pull still issues zero bulk fetches.

### Rejected alternates
- **Resolve the URL to its configured remote name, then reuse the name-keyed gate.**
  Re-introduces a name dependency and an extra `git remote` enumeration for no benefit
  over the direct regex scan.
- **G3 — drop `--filter=blob:none` from the managed clone.** Correct in the limit (the
  consumer hydrates both lanes anyway) but a larger behavior change than this bugfix
  intends; it also transfers `main`'s blobs the consumer never uses.

---

## The CI fidelity gap that hid the regression

The original §B regression test built its fixture partial clone correctly (promisor
flag under the remote name `origin`) but then **drove the hydrate with the same
`origin` token** — a calling convention no real caller uses. Because the fixture stored
and read the flag under the same token, the name-keyed gate matched, the bulk fetch
fired, and the test passed — masking the production miss entirely.

### Closing the gap
The strengthened test now exercises the **production calling convention**:

- **P56.B1u** — fixture stores the promisor flag under `origin` (real
  `git clone --filter=blob:none`), then drives the hydrate with a **distinct remote
  token** (`squad-config`, exactly as `assign` registers a config lane on its own
  remote). It asserts the promisor flag is *not* readable under the driving token and
  that the bulk `--no-filter` fetch still fires exactly once. This fails on the pre-fix
  name-keyed gate (bulk count 0) and passes after the fix (bulk count 1).
- **P56.B1s** — uses the `_hydrateGit` exec seam to assert the network-touching
  invocation count is identical for 5 files and for 1,500 (O(1) per lane), driven by
  the same non-promisor-named token, without paying for 1,500 real `cat-file` spawns.
- **P56.B1 / P56.B2** — the pre-existing origin-token and idempotency cases stay green,
  confirming the convenient path and the fast-path skip ordering are not regressed.
- **P56.B3** — a full (non-partial) clone hydrate asserts the bulk `--no-filter` fetch
  count is **0**, locking decision G's constraint that G1 adds no network to the shared
  non-managed `--pull` path (no promisor remote ⇒ scan finds nothing ⇒ bulk skipped).

Any future §B change that re-couples the gate to the caller's token will now trip
P56.B1u / P56.B1s in CI.

---

## Amendment (2026-07-23) — §B had a SECOND, independent defect: the bulk fetch no-ops on the already-present ref

56a-v1 (above) landed the remote-agnostic gate and was ingested into a preview.20 pack.
**The gate now fires correctly — but the live managed cold-start was still ~41 min.**
The gate was necessary but not sufficient; §B's bulk fetch itself was a silent no-op.

### The second defect

`hydrateTeamRootFromRef` fetches the lane ref in Step 1 with a *filtered* fetch (under the
blob:none partial-clone config — commit + trees, **no blobs**). §B then ran:

```ts
git(['fetch', '--no-filter', remote, refspec]);   // backfilled ZERO blobs
```

Because the ref's **commit** is already present from Step 1, git's negotiation is commit-based
and reports "up-to-date" — `--no-filter` does **not** retroactively backfill blobs an earlier
filtered fetch decided to skip. The blobs were never materialized, so Step 4's `cat-file blob`
write-out fell back to per-blob promisor fetches (issued *inside* the `cat-file` subprocess) =
O(files). O(N) restored — one layer deeper than the gate bug.

Empirical confirmation (real `akubly_microsoft/squads`, isolated blobless clone):

| Step | local blob count |
| --- | --- |
| `git clone --filter=blob:none` | 0 |
| filtered `git fetch origin <refspec>` (Step 1) | 0 |
| `git fetch --no-filter origin <same-refspec>` (§B v1) | **0** ← no-op |
| `git fetch --refetch --no-filter origin <same-refspec>` (fix) | **1055** ← backfilled |

### Decision G refinement (2) — bulk fetch must `--refetch` to backfill blobs on an already-present ref

```ts
// §B bulk hydrate — was: ['fetch', '--no-filter', remote, refspec]
git(['fetch', '--refetch', '--no-filter', remote, refspec]);
```

`--refetch` tells git to ignore what it already has and re-fetch all reachable objects under the
current (now unfiltered) filter, backfilling exactly the blobs Step 1 skipped — in one
O(1)-per-lane transfer. Decision G1's O(1)-per-lane guarantee and the `.last-hydrate-sha` /
`.last-config-hydrate-sha` fast-path skip ordering are unchanged (an unchanged-tip re-pull still
short-circuits at the sentinel before §B). **End-to-end proof** (live isolated managed cold-start,
preview.20 dist patched with `--refetch`): `ELAPSED: 305 s` vs `2482 s` unpatched, with **zero**
cycling `git-remote-https` child processes — the O(N) signature is gone. The residual ~5 min is
fixed upgrade overhead (skill migration + Copilot payload refresh + npm), independent of file count.

### The deeper CI fidelity gap — exec-call count is blind to per-blob lazy fetches

The v1 test (P56.B1u / P56.B1s) counts explicit `exec(['fetch', …])` invocations and asserts that
count is file-count-independent. But the O(N) cost is the per-blob lazy promisor fetch git performs
*internally, inside the `cat-file` subprocess* — **invisible to the exec spy**. So the test passed
whether blobs arrived via the bulk fetch OR via hidden per-blob fetches; with a tiny local fixture
the lazy path is instant, so the test was fast AND green while measuring the wrong thing. An
exec-call counter can prove the gate fires but can **never** prove the bulk fetch actually
materialized blobs.

### Closing the deeper gap

- **P56.B1b** — the second-defect trap. It drives the hydrate on the production convention
  (promisor flag under `origin`, driven by the distinct `squad-config` token) and models git's
  fetch/`cat-file` object semantics through the `_hydrateGit` seam: Step 1 leaves blobs absent, a
  plain `--no-filter` re-fetch of the already-present ref is a no-op, only `--refetch --no-filter`
  backfills, and a `cat-file blob` on an absent blob is a counted hidden promisor fetch. It asserts
  the write-out issues **zero** lazy fetches. This fails on pre-`--refetch` code (40 hidden fetches
  = O(files)) and passes after the fix — making the previously-invisible cost a hard CI gate.
  (A real `--filter=blob:none` fixture cannot reproduce the absent-blob state deterministically
  here: the host git is a VFS/Scalar fork that prefetches blobs over the `file://` transport, so a
  local clone never leaves them missing and the two fetch variants are indistinguishable on disk.
  The seam models the documented git contract instead — and, crucially, is proven non-vacuous by
  failing red on the unfixed code.)

Any future §B change that reverts to a non-`--refetch` bulk fetch — or otherwise lets the
write-out fall back to per-blob promisor fetches — will now trip P56.B1b in CI.
