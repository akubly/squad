# 42 — Fold pipeline: subtree-overlay correctness and run-level serialization

## Summary

The callsign-generic fold pipeline introduced in piece 41 folds each published inbox ref
into its callsign's `squad/state/<callsign>` branch by materializing the inbox's `.squad`
tree onto the checked-out state branch. The mechanism it uses to place that tree fails on
every fold after the first: it binds the inbox subtree at the `.squad/` path with
`git read-tree --prefix=.squad/ -u`, which requires the target path to be unoccupied, but
a state branch that has already been folded once already carries a `.squad/` tree. The
second and subsequent folds into a callsign's state branch therefore abort.

This piece (1) replaces the subtree placement with a deterministic overlay that succeeds
whether or not the state branch already contains `.squad/`, applies the inbox session
content, and does not let the inbox copy of the pipeline-owned `publish-history.json`
overwrite the accumulating state history; and (2) decides whether to serialize Azure
DevOps fold runs at the run level so the fetch→fold→push critical section for a given
state branch cannot overlap across runs.

Stack position: Part 42 of the cross-repo arc. Branches off piece 41
(`squad/piece-41-fold-pipeline-repo-root`). Depends on the callsign-generic fold template
(repository-root placement, run-time callsign discovery, per-callsign fold loop,
self-healing publish-history, and push gated on fold success) introduced in piece 41.

Changeset requirement: the fold-pipeline templates under `packages/squad-cli/` are touched
— include a `patch` changeset entry for `@bradygaster/squad-cli`.

---

## Problem

Piece 41 made the default fold pipeline callsign-generic: one definition installed at the
repository root discovers the distinct callsigns on the remote at run time and folds each
into its own `squad/state/<callsign>` branch, with a self-healing `publish-history.json`
and a state-branch push gated on fold success. Two correctness gaps remain in the fold
step body.

**1. The subtree overlay fails when the state branch already contains `.squad/`.**
For each inbox ref the fold body places the inbox's `.squad` tree onto the working copy of
the state branch with:

```bash
git rm -r --cached .squad/ 2>/dev/null || true
git read-tree --prefix=.squad/ -u "$INBOX_SQUAD_TREE"
git add .squad/
```

`git read-tree --prefix=.squad/` binds a tree object at the `.squad/` path and requires
that path to be unoccupied in the index. The `git rm --cached` clears the index entry, but
`-u` then writes the tree into the working directory, where the state branch's existing
`.squad/` files are still present on disk. The bind fails
(`error: Entry '.squad/...' overlaps with '.squad/...'. Cannot bind.`). The first fold into
a freshly orphan-initialized state branch succeeds because `.squad/` is not yet populated;
every fold after that — i.e. the normal steady state of any host with more than one
published session per callsign — aborts. A failed fold is correctly not recorded (piece
41 gates the record on commit success), so the ref is retried on the next run and fails
again: the callsign's state branch is stuck at its first fold.

**2. Azure DevOps fold runs are not serialized at the run level.**
`trigger.batch: true` coalesces a burst of queued CI pushes into a single run, and piece
41 added a workflow-level `concurrency` group to the GitHub variant so GitHub never runs
two fold jobs at once. Azure DevOps has no equivalent guard: a push-triggered run and a
`*/15` scheduled run (or two pushes that straddle a run boundary) can execute
concurrently. Both fetch, fold, and push the same `squad/state/<callsign>`. The
`--force-with-lease` on the push means the losing run's push is rejected on a stale lease
rather than silently clobbering the winner — so this is not a data-loss defect — but the
losing run errors and drops its folds until the next trigger re-folds them, which is
wasteful and produces spurious red runs.

---

## Proposed change

Sub-proposal A is Tier 1 (concrete, implementation-ready). Sub-proposal B is Tier 2
(a decision with an onboarding cost) and is gated on the maintainer's choice.

**Recommended implementation order:** A (subtree overlay) first, then B if accepted.

---

## Tier 1

### A. Deterministic `.squad/` subtree overlay

**Current behavior:** `git read-tree --prefix=.squad/ -u "$INBOX_SQUAD_TREE"` binds the
inbox subtree and fails when the state branch already carries `.squad/`.

**Required behavior:** Overlay the inbox `.squad` tree onto the checked-out state branch so
that the operation:

1. **Succeeds whether or not the state branch already contains `.squad/`** — no bind/overlap
   failure on the second and subsequent folds.
2. **Applies the inbox session content**, with the inbox copy authoritative for every file
   it carries (the published session is the source of truth for its own `.squad/` files).
3. **Preserves the pipeline-owned `publish-history.json`.** `publish-history.json` is
   maintained by the fold pipeline on the state branch (the run reads the already-folded
   set from it before the loop and rewrites it after the loop). The per-ref overlay must
   not replace the accumulating state copy with the inbox's copy of that file; otherwise
   the post-loop history rewrite reads the last-folded session's history and the recorded
   fold set is corrupted.

**Recommended implementation:** Replace the `rm --cached` + `read-tree --prefix` pair with
an archive-based overlay that cannot raise a bind error, excluding the pipeline-owned
history file from the inbox payload:

```bash
git archive refs/fold-tmp/inbox .squad \
  | tar -x --exclude='.squad/publish-history.json'
git add .squad/
```

`git archive | tar -x` overlays files onto the existing tree rather than binding a subtree,
so a populated `.squad/` on the state branch is not an error; `--exclude` keeps the
pipeline-owned `publish-history.json` on the state side. An equivalent approach that reads
the inbox subtree into a temporary index and checks it out file-by-file is acceptable, so
long as all three required behaviors hold.

**Hard constraints:**
- The overlay succeeds on a state branch that already contains a `.squad/` tree (the
  steady-state case), not only on a freshly initialized branch.
- The inbox copy wins for the session files it carries.
- The state branch's `publish-history.json` is not overwritten by the inbox copy during
  the overlay; the run's post-loop rewrite remains the sole writer of that file.
- The change is applied to **all** fold templates (both platforms) and the mirrored
  template trees are kept byte-identical (the repository's template-sync mechanism is the
  source of the mirrors; edit the canonical template and re-sync).
- The fold remains idempotent: a re-run that re-folds an already-recorded ref still
  produces no new state commit.

**Test surface:** (a) A fold into a state branch whose tree already contains `.squad/`
(simulating a second published session for the callsign) succeeds and does not raise an
overlap/bind error. (b) After folding an inbox ref, a file that the inbox session carries
is present at its inbox content on the state branch (inbox wins). (c) The state branch's
`publish-history.json` reflects the pipeline's accumulated history, not the inbox session's
copy, after a fold of a session that itself carried a `.squad/publish-history.json`.
(d) The mirrored template trees remain byte-identical after the change.

---

## Tier 2 (decision)

### B. Run-level serialization of the Azure DevOps fold

**Decision required:** whether to serialize Azure DevOps fold runs at the run level, or to
accept the existing `batch: true` + `--force-with-lease` behavior as sufficient.

**Context.** The GitHub variant is serialized by the workflow-level `concurrency` group
added in piece 41. Azure DevOps has no pure-YAML mutex; serializing runs requires a
**protected resource** — an Environment (or a repository/agent-pool resource) referenced
with an exclusive lock — which the host must create as a one-time onboarding step.

**Option B1 — Adopt an exclusive lock (recommended).** Reference an ADO Environment from
the fold stage and configure the pipeline's `lockBehavior: sequential` so queued runs serialize
through the protected resource. Keep `batch: true` for coalescing and `--force-with-lease`
as the integrity backstop. Document the new onboarding prerequisite (the host must create
the named Environment and grant the pipeline access to it), in the same place piece 41
documents the CI service-identity permissions. Cost: a structural change to the ADO YAML
(the fold becomes a stage with `lockBehavior`, and on a protected resource an exclusive
lock applies) plus one onboarding step.

**Option B2 — Accept current behavior.** Rely on `batch: true` to coalesce and
`--force-with-lease` to reject a stale-lease push; a losing concurrent run errors and its
folds are re-folded by the next trigger (push or the `*/15` schedule). No YAML change, no
onboarding step; the cost is occasional spurious red runs and a fold latency of up to one
schedule interval when a race occurs.

**Hard constraints (if B1 is accepted):**
- The serialization mechanism is pure pipeline configuration plus a documented onboarding
  step; no second pipeline and no change to the fold body logic.
- `--force-with-lease` is retained as the integrity backstop regardless of the lock.
- The onboarding prerequisite (create the named Environment / protected resource and grant
  pipeline access) is documented with a generic platform example
  (e.g. `dev.azure.com/contoso/MyProject`); no specific internal tenant or organization URL.

**Test surface (if B1 is accepted):** generated-YAML assertions that the ADO template
references the Environment and sets `lockBehavior: sequential`, and that the GitHub
template is unchanged. The exclusion of overlapping runs is an Azure DevOps runtime
guarantee, verified by the acceptance review rather than a unit test.

---

## Acceptance

- Build exits 0.
- The fold subtree overlay succeeds on a state branch that already contains `.squad/`; a
  second fold into a callsign's state branch no longer aborts with an overlap/bind error.
- The inbox session content wins for the files it carries, and the state branch's
  pipeline-owned `publish-history.json` is not overwritten by the inbox copy during the
  overlay.
- The fold remains idempotent: re-folding an already-recorded inbox ref produces no new
  state commit.
- The mirrored fold-template trees are byte-identical after the change.
- Sub-proposal B is resolved one way or the other: either the ADO template serializes runs
  through an exclusive lock with the onboarding prerequisite documented (B1), or the
  decision to retain `batch: true` + `--force-with-lease` is recorded in the triage with
  its rationale (B2). No specific internal tenant URL appears in any documentation.
- Integration: with the overlay fix in place, two successive published sessions for the
  same callsign both fold into that callsign's `squad/state/<callsign>` branch (the second
  fold no longer aborts), with the accumulated `publish-history.json` recording both.
- Tests cover: the overlay succeeding over a populated `.squad/` (A), inbox-wins content
  (A), history preservation (A), and — if B1 is accepted — the ADO lock configuration (B).
- A `patch` changeset for `@bradygaster/squad-cli` is present in the diff.
- Scrub gate: changes contribute no new hits.
- Single squashed commit with the `Co-authored-by: Copilot ...` trailer; no PR opened.
