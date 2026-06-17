@Lead and Team, this is the Phase B replay session for piece 42 of the upstream stack.
Phase A staged the piece 42 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 42 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-42-fold-subtree-overlay-and-serialization` off
  `squad/piece-41-fold-pipeline-repo-root`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve
  that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of
  the clone.

Read these inputs in order before any work (use `git show` from the spec branch —
do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/40-callsign-namespaced-transport.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/41-fold-pipeline-repo-root-and-generic-discovery.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/42-fold-subtree-overlay-and-serialization.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `42-fold-subtree-overlay-and-serialization.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context: it maps the dogfood-discovered work
to delivered (piece 41), specced (piece 42 — this session), and planned candidates
(43–45). Read it so you understand where piece 42 sits and what depends on it; implement
**only** piece 42 here.

Piece 42 hardens the fold step body that piece 41 introduced. It (A) replaces the
`.squad/` subtree placement with a deterministic overlay that succeeds when the state
branch already contains `.squad/`, applies the inbox session content, and preserves the
pipeline-owned `publish-history.json`; and (B) decides whether to serialize Azure DevOps
fold runs at the run level. A is Tier 1 (implement). B is a Tier-2 decision with an
onboarding cost — triage it first and either implement option B1 or record the choice of
B2 with rationale.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-42-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Deterministic `.squad/` subtree overlay (archive/tar overlay excluding the pipeline-owned `publish-history.json`); applies to both fold templates | Tier 1 | Accept |
| B — Run-level serialization of the ADO fold (B1 exclusive-lock Environment + onboarding doc, **recommended**; or B2 retain `batch: true` + `--force-with-lease`) | Tier 2 | Decide — record B1 or B2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-42-triage.md` before writing
any product code. If B1 is chosen, implement it; if B2, record the rationale and make no
ADO serialization change.

---

## Workflow for piece 42

**a.** Create the implementation branch off piece 41 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-42-fold-subtree-overlay-and-serialization <worktree-path> squad/piece-41-fold-pipeline-repo-root
```

A placeholder branch may already exist at the tip of piece 41 with no commits of its own;
if so, reset/reuse it — it must start from the piece-41 tip and carry only this session's
work.

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-42-triage.md`
before the first product file is modified.

**c.** For sub-proposal A (and B1 if accepted), implement TDD: write failing tests first,
then implementation, red-to-green. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare the strip-list against the piece-41 base — the count
must not grow).

**e.** Add a changeset:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Fold pipeline overlays the inbox
.squad tree without a bind failure when the state branch already contains .squad/, and
preserves the pipeline-owned publish-history.json" (extend with the ADO serialization note
if B1 is implemented).

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A, and B1/B2 outcome), triage outcome, scrub gate
result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-42-fold-subtree-overlay-and-serialization
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Sub-proposal A — Deterministic subtree overlay

In each fold template (canonical source `.squad-templates/fold/<platform>/fold-squad-state.yml`;
the trees under `templates/`, `packages/squad-cli/templates/`, and
`packages/squad-sdk/templates/` are generated mirrors — edit the canonical source, then run
the repository's template-sync script and verify all four copies of each platform file are
byte-identical), locate the per-ref subtree placement in the fold loop:

```bash
git rm -r --cached .squad/ 2>/dev/null || true
git read-tree --prefix=.squad/ -u "$INBOX_SQUAD_TREE"
git add .squad/
```

Replace it with an overlay that cannot raise a bind error and preserves the pipeline-owned
history file:

```bash
git archive refs/fold-tmp/inbox .squad \
  | tar -x --exclude='.squad/publish-history.json'
git add .squad/
```

Notes:
- The runners are Linux (`ubuntu-latest` on GitHub; the ADO template runs the same bash
  body), so `git archive | tar -x` is available. Keep the fold body under the
  `set -euo pipefail` established in piece 41; a failed `git archive`/`tar` aborts before
  the per-ref record and before the push.
- `INBOX_SQUAD_TREE` resolution and the surrounding "no `.squad/` subtree → skip"
  guard from piece 41 are unchanged; only the placement command changes.
- Do not reintroduce `read-tree --prefix`. Do not let the inbox copy of
  `publish-history.json` reach the working tree; the post-loop history rewrite (piece 41)
  remains the sole writer of that file.
- Keep the fold idempotent: the already-folded check (reading recorded refs from
  `publish-history.json` before the loop) is unchanged.

Tests assert on generated-YAML content (the overlay command is present; `read-tree
--prefix=.squad/` is absent; `publish-history.json` is excluded from the inbox payload) and
on the mirrored template trees being byte-identical. If an integration-style test harness
folds two successive sessions for one callsign, assert the second fold does not error and
that the accumulated `publish-history.json` records both.

### Sub-proposal B — ADO run-level serialization (decision)

If **B1** (recommended): reference an ADO Environment from the fold stage and set the
pipeline `lockBehavior: sequential` so queued runs serialize through the protected resource.
Keep `trigger.batch: true` and `--force-with-lease`. Document the onboarding prerequisite
(the host creates the named Environment / protected resource and grants the pipeline
access) alongside the piece-41 CI service-identity permission docs, using a generic
platform example such as `dev.azure.com/contoso/MyProject`. Add generated-YAML assertions
for the Environment reference and `lockBehavior`. Leave the GitHub template unchanged (its
`concurrency` group from piece 41 already serializes runs).

If **B2**: make no ADO serialization change. Record in the triage file that `batch: true` +
`--force-with-lease` is accepted as sufficient, with the rationale (a losing concurrent run
fails its lease rather than clobbering state, and the next trigger re-folds), so the choice
is auditable.

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`); no existing tests broken. (The full suite is heavy and
  some integration tests are flaky under worker contention — confirm the deliverable test
  files for the fold templates are green, and that any failures elsewhere reproduce on the
  piece-41 base, i.e. are pre-existing rather than introduced here.)
- Sub-proposal A: the subtree overlay succeeds on a state branch that already contains
  `.squad/`; the inbox content wins for its files; the state branch's `publish-history.json`
  is not overwritten by the inbox copy; `read-tree --prefix=.squad/` no longer appears in
  the templates; the mirrored template trees are byte-identical.
- Sub-proposal B: either the ADO template serializes runs via an exclusive lock with the
  onboarding prerequisite documented (B1), or the triage records the B2 choice with
  rationale. No specific internal tenant URL appears in any documentation.
- Integration: two successive published sessions for one callsign both fold into that
  callsign's state branch (the second no longer aborts), with the accumulated history
  recording both.
- Scrub gate: changes contribute no new hits.
- Changeset: `patch` for `@bradygaster/squad-cli` is present.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
