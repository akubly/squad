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
