@Lead and Team, this is the Phase B replay session for piece 44 of the upstream stack.
Phase A staged the piece 44 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 44 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts` off
  `squad/piece-43-cross-repo-state-remote-and-branch-resolution`
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
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/44-pipeline-file-injection-hygiene-on-shared-hosts.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `44-pipeline-file-injection-hygiene-on-shared-hosts.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context: it maps the dogfood-discovered work
to delivered (piece 41), specced (pieces 42–44), and planned candidates (45–46). Read it so
you understand where piece 44 sits and what depends on it; implement **only** piece 44 here.

Piece 44 makes pipeline-file injection hygienic on a host that may carry more than one fold
definition. It (A) makes the scoped `install-fold-pipeline --callsign` write a distinct,
callsign-named file `fold-squad-state.<callsign>.yml` so two scoped installs on one
repository never collide; and (B) makes the cross-repo `sync` pipeline injection embed a
single canonical pipeline path so a stale alternate-directory copy is never carried into the
published snapshot. A, B are Tier 1 (implement). C is a Tier-2 decision (whether the scoped
install also removes a stale alternate-directory copy) — triage it first and either
implement C1 (leave the stale copy in place, rely on B's single-embed; **recommended**) or
C2 (remove the superseded copy) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-43 base; do not assume signatures.

- `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts` — `installFoldPipeline`:
  the `--callsign` validation against `CALLSIGN_RE`, the content parameterization block, the
  fixed `const destPath = path.join(targetDir, 'fold-squad-state.yml')`, and the three-way
  idempotency/conflict gate that follows. Confirm the `InstallFoldPipelineOptions` shape and
  that `CALLSIGN_RE` is already imported and applied before any write.
- `packages/squad-cli/src/cli/commands/sync.ts` — `publishTeamRootToInbox`: the pipeline-YAML
  injection block that independently probes `.azuredevops/fold-squad-state.yml` and
  `.github/workflows/fold-squad-state.yml` and stages whichever exist (it builds the snapshot
  via an isolated `GIT_INDEX_FILE` with `git hash-object` + `git update-index --cacheinfo`).
  Confirm that `callsign` is a parameter of `publishTeamRootToInbox` and is always present on
  the cross-repo publish path. NOTE: this injection block was introduced by piece 39, not
  piece 42 — confirm the exact lines on the piece-43 base before changing them.
- The callsign validator: `CALLSIGN_RE` in `packages/squad-sdk/src/validation.ts`. REUSE it
  for any callsign-named filename derivation — do not introduce a second pattern. If you
  factor the `fold-squad-state.<callsign>.yml` derivation into a shared helper, place it in
  the SDK and adopt it from both the install and injection call sites.
- Confirm the source template path stays `templates/fold/<platform>/fold-squad-state.yml`
  (only the destination filename changes). Verify no `.squad-templates/fold/` mirror change
  is required by the filename convention (the template *content* is unchanged).

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-44-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Scoped `--callsign` install writes a distinct callsign-named file `fold-squad-state.<callsign>.yml`; default install unchanged; reuse `CALLSIGN_RE`; per-file conflict gate | Tier 1 | Accept |
| B — `sync`-time injection resolves a single canonical pipeline path (callsign-named preferred, ADO-before-GitHub tiebreak) and embeds only that one; no stale alternate-directory copy in the snapshot | Tier 1 | Accept |
| C — Stale alternate-directory cleanup on scoped install: C1 leave the stale copy in place and rely on B's single-embed (**recommended**); or C2 remove the superseded copy | Tier 2 | Decide — record C1 or C2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-44-triage.md` before writing any
product code.

---

## Workflow for piece 44

**a.** Create the implementation branch off piece 43 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts <worktree-path> squad/piece-43-cross-repo-state-remote-and-branch-resolution
```

A placeholder branch may already exist at the tip of piece 43 with no commits of its own;
if so, reset/reuse it — it must start from the piece-43 tip and carry only this session's
work.

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-44-triage.md`
before the first product file is modified.

**c.** For each accepted sub-proposal, implement TDD: write failing tests first, then
implementation, red-to-green. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes
contribute **no new** hits (compare the strip-list against the piece-43 base — the count
must not grow). The stack's package scope is `@bradygaster/squad-*`; keep it as-is and do
not let any other scope leak into product strings.

**e.** Add a changeset (REQUIRED — `packages/*/src` is touched):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. If you factor the filename derivation into a
shared SDK helper, also select `patch` for `@bradygaster/squad-sdk`. Summary:
"Scoped install-fold-pipeline --callsign writes a callsign-named fold-squad-state.<callsign>.yml
so two scoped installs on one repo no longer collide, and cross-repo sync embeds a single
canonical pipeline path instead of every directory copy."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A, B, and the C1/C2 outcome), triage outcome, scrub
gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-44-pipeline-file-injection-hygiene-on-shared-hosts
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under
  `packages/squad-cli/node_modules` and shadows the workspace source, remove it so the
  workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks`) to avoid worker-contention
  timeouts.
- Revert any incidental `package.json` / `package-lock.json` churn from install/build before
  committing.

### Sub-proposal A — callsign-named scoped install

Derive the destination filename from the callsign: `fold-squad-state.<callsign>.yml` when
`options.callsign` is set, else `fold-squad-state.yml`. The callsign is already validated
against `CALLSIGN_RE` at the top of `installFoldPipeline` (exit 1 on a malformed value), so
the derived filename is always git/file-system-safe. Thread the resolved filename through the
idempotency/conflict gate and every user-facing message (the "already installed", "exists
with different content", and "Installed" lines) so they name the resolved path. Leave the
source template path and the content parameterization untouched. Do not change the default
(no-callsign) written file.

Tests: scoped `--callsign alpha` writes `fold-squad-state.alpha.yml` (not the generic name);
two scoped installs for `alpha` and `bravo` on one repo produce two files and the second
exits 0; default install still writes `fold-squad-state.yml`; idempotent re-run of a scoped
install is a no-op; a differing same-named scoped file still trips the conflict gate naming
the callsign-named path.

### Sub-proposal B — canonical single-embed injection

Replace the two independent `existsSync` probes with an ordered candidate resolution that
embeds the first existing file and stops:

```
.azuredevops/fold-squad-state.<callsign>.yml
.github/workflows/fold-squad-state.<callsign>.yml
.azuredevops/fold-squad-state.yml
.github/workflows/fold-squad-state.yml
```

The callsign-scoped candidates are only included when `callsign` is set. Stage the resolved
file into the isolated index at its real host-relative path using the same
`git hash-object` + `git update-index --add --cacheinfo 100644,<sha>,<relpath>` plumbing the
current block uses. Embed at most one; never stage a second candidate. Keep the no-pipeline
case (no candidate exists) a no-op as today.

Tests: a team root carrying pipeline files in BOTH `.azuredevops/` and `.github/workflows/`
embeds only the `.azuredevops/` copy (verify the published inbox ref's tree contains the ADO
path and NOT the GitHub path); a team root with only the GitHub copy embeds that copy; a
callsign-named file is preferred over a generic one; a team root with no pipeline file embeds
none. Use the existing bare-remote + `listBareRefs`/`showBareFile` helpers (see
`test/cli/piece-36-publish-loop-repair.test.ts` and the callsign-transport tests) to inspect
the published snapshot tree.

### Sub-proposal C — stale-copy decision

If **C1** (recommended): the scoped install writes only its callsign-named file and does not
delete any other directory's copy; B's single-embed keeps the snapshot clean. Record C1 and
rationale in the triage file; add the test that a pre-existing generic file is left in place.

If **C2**: the scoped install removes the superseded generic / alternate-platform copy. Add a
test asserting the superseded file is gone. Record C2 and rationale in the triage file.

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`); no existing tests broken. The full suite is heavy and some
  integration tests are flaky under worker contention — confirm the deliverable test files
  (install-fold-pipeline and the publish injection) are green, and that any failures
  elsewhere reproduce on the piece-43 base (i.e. are pre-existing rather than introduced
  here). The existing scoped-install assertions (`install-fold-pipeline.test.ts` B3/B4) that
  read the fixed `fold-squad-state.yml` must be updated to the callsign-named path.
- Sub-proposal A: a scoped `--callsign` install writes `fold-squad-state.<callsign>.yml`; two
  scoped installs for different callsigns coexist without tripping the conflict gate; the
  default install is unchanged.
- Sub-proposal B: the cross-repo injection embeds exactly one canonical pipeline path; a
  stale alternate-directory copy is not embedded; single-platform and no-pipeline cases are
  unchanged.
- Sub-proposal C: the chosen option (C1 or C2) is implemented and recorded in the triage with
  rationale.
- Changeset: `patch` for `@bradygaster/squad-cli` present (plus `@bradygaster/squad-sdk` if a
  shared helper is added there).
- No specific internal tenant URL appears in any documentation.
- Scrub gate: changes contribute no new hits.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
