@Lead and Team, this is a Phase B **bugfix** replay session — a stacked follow-up to piece 56.
Phase A staged the bug spec `56a-bulk-hydrate-promisor-gate-regression.md` on the
`akubly/upstream-specs` branch. Phase B implements the fix on its own branch, fully tested. No PR
creation in Phase B.

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
2. Fix: detect the partial clone **remote-agnostically** — scan `git config --get-regexp
   '^remote\..*\.promisor$'` for any `true` (a managed clone has exactly one remote; a full clone has
   none, so non-managed `--pull` stays byte-identical and issues no extra network). Then run the bulk
   `fetch --no-filter <remote> <refspec>` as today. Preserve decision G's O(1)-per-lane guarantee and
   the fast-path skip ordering.
3. **Test (the part CI missed):** the §B regression test must (a) build the fixture so the promisor
   flag lives under the remote NAME as real `git clone --filter` does, (b) drive the hydrate with a
   remote token that is NOT the configured name (a URL), and (c) assert the count of network-touching
   git invocations is independent of file count (one blob-materializing fetch per lane for 5 files and
   for 1,500). This test must fail on today's code and pass after the fix.

## Deliverables

- The fix in `sync.ts`, minimal and surgical.
- The strengthened §B regression test proving O(1)-per-lane on the URL-remote path.
- A `patch` changeset for `@bradygaster/squad-cli`.
- Triage note recording the decision-G refinement (name-keyed → remote-agnostic promisor detection) and
  the CI fidelity gap that hid it.
- No fold-template edits; §F stays byte-identical. Do not regress warm-assign, monorepo-host hydrate, or
  hydrate idempotency.

Full acceptance criteria are in the 56a spec. When green and committed on the stacked branch, stop —
Phase C (the upstream PR) is a later, separate session.
