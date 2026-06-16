@Lead and Team, this is the Phase B replay session for piece 41 of the upstream stack.
Phase A staged the piece 41 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted Tier-1 sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 41 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-41-fold-pipeline-repo-root` off
  `squad/piece-40-callsign-namespaced-transport`
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
```

If `41-fold-pipeline-repo-root-and-generic-discovery.md` does not exist on
`akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be
staged before this session proceeds.

Piece 41 hardens fold-pipeline installation for host repositories that carry squad state
in nested subdirectories. It (A) resolves the install target to the git repository root,
(B) makes the default generated pipeline a callsign-generic definition that discovers
callsigns at run time and folds each into its own `squad/state/<callsign>` branch, and
(C) documents the CI service-identity permission prerequisite. All three sub-proposals
are Tier 1. There is no decision-gated Tier-2 item in this piece.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-41-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Resolve install target to repo root via `git rev-parse --show-toplevel` (`install-fold-pipeline.ts`) | Tier 1 | Accept |
| B — Callsign-generic default pipeline: repo-wide batched trigger + run-time callsign discovery + per-callsign fold to `squad/state/<callsign>`; retain `--callsign` scoped mode from piece 40 | Tier 1 | Accept — both ADO and GitHub templates |
| C — Document CI service-identity prerequisite (Contribute + Create branch + Force push on the host repo) | Tier 1 | Accept — docs only |

Record accept for each sub-proposal in `.squad/decisions/inbox/piece-41-triage.md` before
writing any product code.

---

## Workflow for piece 41

**a.** Create the implementation branch off piece 40 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-41-fold-pipeline-repo-root <worktree-path> squad/piece-40-callsign-namespaced-transport
```

A placeholder branch `squad/piece-41-fold-pipeline-repo-root` may already exist at the tip
of piece 40 with no commits of its own; if so, reset/reuse it as the base — it must start
from the piece-40 tip and carry only this session's work.

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-41-triage.md`
before the first product file is modified.

**c.** For each accepted sub-proposal (A–C), implement TDD: write failing tests first,
then implementation, red-to-green. Recommended order: A (repo-root target), B
(callsign-generic template + discovery), C (docs). See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking.

**e.** Add a changeset:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Fold pipeline installs at the
repository root and the default generated pipeline discovers callsigns at run time,
folding each inbox into its own squad/state/<callsign> branch; --callsign retains the
scoped single-callsign pipeline."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–C), triage outcome, scrub gate result, and
changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-41-fold-pipeline-repo-root
```

**h.** STOP. Do not open a PR.

---

## Implementation notes

### Sub-proposal A — Repo-root target (`install-fold-pipeline.ts`)

Locate where the command computes the output directory from the squad entry's path.
Replace the assumption that the entry's parent directory is the repository root with an
explicit resolution:

```typescript
const repoRoot = runGit(['rev-parse', '--show-toplevel'], { cwd: entryDir }).trim();
```

Write the definition relative to `repoRoot`:
- ADO: `path.join(repoRoot, '.azuredevops', 'fold-squad-state.yml')`
- GitHub: `path.join(repoRoot, '.github', 'workflows', 'fold-squad-state.yml')`

If `git rev-parse --show-toplevel` exits non-zero (target is not a git working tree), fail
with a clear error directing the user to run the command against a checked-out repository,
and write nothing. For a host whose `.squad` is already at the repository root,
`--show-toplevel` returns that directory, so the output path is unchanged — assert this in
a test so the simple-host case is pinned.

### Sub-proposal B — Callsign-generic default template + run-time discovery

Add a new template variant that becomes the default generated output when `--callsign` is
absent. For both platforms:

- **Trigger:** repository-wide inbox glob. ADO `trigger.branches.include:
  ['refs/heads/squad/inbox/*']` with `trigger.batch: true`; GitHub `on.push.branches:
  ['squad/inbox/**']`.
- **Discovery step** (run-time, in the job body):
  ```bash
  callsigns="$(git ls-remote --heads origin 'refs/heads/squad/inbox/*' \
    | sed -nE 's#^[0-9a-f]+\srefs/heads/squad/inbox/([^/]+)/.*#\1#p' \
    | sort -u)"
  ```
- **Per-callsign fold loop:** iterate `callsigns`; for each, validate it against the
  callsign character pattern (reuse the `CALLSIGN_RE` constant introduced in piece 40 —
  apply the same character class in the YAML's shell validation, e.g. reject anything
  outside the allowed set and `continue` with a logged warning), read only that
  callsign's inbox refs, fold into `squad/state/<callsign>`, and push with
  `--force-with-lease`.
- **Idempotency:** the fold must not produce a new state commit when the inbox ref it
  would fold is already represented in the target state branch (re-runs and races are
  no-ops). Preserve whatever publish-history / already-folded check the piece-40 templates
  use; this piece does not change that mechanism.

Retain the `--callsign <name>` path exactly as piece 40 defined it (scoped trigger
`refs/heads/squad/inbox/<name>/*` for ADO and `squad/inbox/<name>/**` for GitHub; target
`squad/state/<name>`). The only change to the `--callsign` path is the repo-root output
location from sub-proposal A.

Tests assert on the generated YAML string content (trigger globs, `batch: true`, the
discovery command substring, the per-callsign `squad/state/` fold target, and the absence
of a single hardcoded `squad-state` fold target in the default output), and on the
`--callsign` scoped output being unchanged. The run-time fold execution itself is covered
by the integration acceptance criterion, not by unit tests.

**Do not** pull in the fold step-body robustness work (empty/malformed
`publish-history.json` self-heal; per-step `succeeded()` gating). That is piece 42 and
applies to all templates. Keep a correct minimal fold body here and leave a clean seam.

### Sub-proposal C — Onboarding prerequisite docs

In the `install-fold-pipeline` command help text and the fold-pipeline section of the CLI
docs, document that the CI service identity running the fold pipeline must have
**Contribute**, **Create branch**, and **Force push** permission on the host repository,
because the fold job creates and force-updates `squad/state/<callsign>` branches. Use a
generic platform example such as `dev.azure.com/contoso/MyProject`. Do not reference any
specific internal tenant or organization URL.

---

## Acceptance gate

- `npm run build` exits 0.
- All new tests pass (`npm test`); no existing tests broken.
- Sub-proposal A: install target is resolved via `git rev-parse --show-toplevel`; a
  nested-subdirectory entry writes under the repo root; a root-level entry path is
  unchanged; a non-git target errors and writes nothing.
- Sub-proposal B: the default generated pipeline (no `--callsign`) is the callsign-generic
  definition (repo-wide batched trigger, run-time discovery, per-callsign
  `squad/state/<callsign>` fold) and does not fold into a single flat `squad-state`
  branch; `--callsign <name>` still produces the scoped piece-40 pipeline for both
  platforms.
- Integration scenario: one installed callsign-generic pipeline, inbox pushes for two
  distinct callsigns on one host repository, both fold into their own
  `squad/state/<callsign>` branches in one batched run with no cross-contamination, and a
  repeated run produces no duplicate state.
- Sub-proposal C: the CI service-identity permission prerequisite is documented with no
  specific internal tenant URL.
- Scrub gate: changes contribute no new hits.
- Changeset: `patch` for `@bradygaster/squad-cli` is present.
- Commit: single squashed commit with `Co-authored-by: Copilot ...` trailer.
- Branch pushed to `origin`; no PR opened.
