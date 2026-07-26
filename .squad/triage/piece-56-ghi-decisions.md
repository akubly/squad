# Piece 56 — Tier-2 Decision Triage (G / H / I)

Replay Phase B, feature branch
`squad/piece-56-managed-cold-start-hardening-and-fold-ref-garbage-collection`.
Recorded before implementation of sub-proposals A–F. Fork-internal `.squad/` state
(stripped by Phase C). Decisions resolved by the coordinating squad after the
verify-first pass against the piece-55 base.

The three Tier-2 decisions were triaged first because A/B/C are implemented against
the recommended options and must still satisfy the same acceptance under the
alternates.

---

## Decision G — managed-clone fetch/hydrate shape

**Chosen: G1 — bulk `git fetch` of each orphan ref tip *without* the blob filter,
then reuse the existing local write-out loop in `hydrateTeamRootFromRef`.**

### Rationale
- **One shared hydrate path.** The non-managed `squad sync --pull` and the managed
  cold-start both funnel through `hydrateTeamRootFromRef`. G1 adds a pre-step (a
  single unfiltered `git fetch <ref>`) *before* the existing `ls-tree` + per-file
  `cat-file blob` write-out loop, so the loop reads purely local objects. No second
  hydrate implementation is forked — the spec's explicit "reuse the shared function,
  do not fork a second hydrate" constraint is honoured.
- **Preserves the partial-clone benefit for `main`.** The managed clone stays
  `--filter=blob:none --no-checkout`; only the two orphan lane tips (state + config)
  are fully fetched. `main`'s blobs — which the consumer never checks out — are never
  transferred.
- **O(1) network round-trips per lane.** The unfiltered fetch pulls every blob
  reachable from the ref tip in a single pack, converting the O(files) lazy promisor
  fetches (one network `cat-file` per file today) into O(1) network calls per lane.

### Rejected
- **G2 (`git archive <ref> .squad | tar -x`).** Fewer processes, but it is a *second
  materialization code path* distinct from the shared `hydrateTeamRootFromRef` that
  `--pull` uses. That fragments the hydrate contract (clean-overwrite/prune semantics,
  `.last-hydrate-sha` skip, monorepo `--absolute-git-dir` handling) across two
  implementations — exactly what the spec's reuse constraint forbids.
- **G3 (drop `--filter=blob:none`).** Simplest, but transfers all of `main`'s blobs
  the consumer never uses, discarding the partial-clone win that pieces 50/55
  deliberately established for large real squads.

### Constraint on B
The bulk fetch is a *pre-step* to the shared function, gated to the ref actually being
hydrated. It must not alter the non-managed `--pull` semantics, must preserve the
`resolveTeamRootGitDir` / `--absolute-git-dir` monorepo handling, and must remain
idempotent: a second cold-start / `--pull` on an unchanged tip stays a no-op via the
`.last-hydrate-sha` fast-path and must NOT re-issue the bulk fetch.

---

## Decision H — cwd-bind policy for cold-start

**Chosen: H1 — auto-bind the invoking product clone, with a `--no-bind` opt-out.**

### Rationale
- **Delivers the one-command promise.** The pilot's #1 rough edge was that cold-start
  ignored the repo the user was standing in and bound nothing. H1 makes
  `cd <product-repo>; squad assign --callsign <cs> --state-remote … --state-branch …`
  stand up the host *and* wire the product clone the user is in — genuinely one
  command, which is the piece-55 promise this piece hardens.
- **Reuses the warm-bind path verbatim.** Sub-proposal A resolves cwd's git root and,
  when it differs from the managed host, invokes the existing warm-assign bind path
  (append git root to `clones[]`, origin-collision detection honouring
  `--allow-origin-collision` and decision-I suppression, cross-repo + product-squad-
  forbid hook installers). No second bind copy.
- **Escape hatch preserved.** `--no-bind` lets a user deliberately stand up a host-only
  consumer from inside a repo (H2's use case) without losing the default ergonomics.
- **Fails soft.** A benign origin collision (product clones on a shared monorepo origin
  legitimately collide with sibling squads) must not hard-fail the one-command flow;
  the bind is wrapped so a collision/bind failure degrades to a warning, not an abort.

### Rejected
- **H2 (explicit follow-up only).** Lower magic, but keeps onboarding at two commands
  and re-introduces exactly the "bound nothing" gap the pilot flagged. A is written so
  that if H2 were chosen it degrades cleanly to printing the exact `squad assign
  <callsign>` follow-up — but H1 is the shipped behaviour.

### Opt-out flag
`--no-bind` (added to assign arg parsing and `SquadAssignOpts`). Non-repo cwd → host-only
(no bind, no warning), unchanged from today.

---

## Decision I — post-hydrate publish-baseline strategy

**Chosen: I1 — stamp `.squad/.last-publish` to the hydrate moment on cold-start.**

### Rationale
- **Matches the existing detection model.** Pending detection is mtime-oriented around
  `.squad/.last-publish`. Writing `.last-publish` at the hydrate timestamp gives an
  honest baseline: immediately after cold-start no team-root file is newer than the
  last publish, so `sync --dry-run` reports **0 pending** instead of re-publishing the
  entire freshly-hydrated squad as a no-op (the pilot's #3 rough edge).
- **Smallest, scoped change.** The stamp is written only on the cold-start hydrate
  path. Pending detection is made mtime-aware *only when `.last-publish` exists* — when
  it is absent the existing "list all allowlisted files" behaviour is preserved, so
  normal edit-then-publish detection and all prior fixtures are unaffected.
- **Correct for bound product clones.** A bound product clone resolves its team root to
  the managed host, so stamping the managed host's `.squad/.last-publish` covers the
  product-clone dry-run too.

### Rejected
- **I2 (SHA-based baseline).** More robust against clock skew, but it is a larger change
  to the sync pending model (make detection content/SHA-aware for the cold-start case)
  and introduces a second notion of "pending" alongside the established mtime model. The
  clock-skew risk is negligible here (hydrate writes files and the stamp in the same
  local operation), so the extra model complexity is not justified.

### Constraint on C
The change must be scoped to the cold-start path and must not weaken pending detection
for normal edits: after cold-start `sync --dry-run` lists 0 pending; after exactly one
genuine team-root edit it lists exactly that one file. C is written against I1 but the
same acceptance holds under I2.
