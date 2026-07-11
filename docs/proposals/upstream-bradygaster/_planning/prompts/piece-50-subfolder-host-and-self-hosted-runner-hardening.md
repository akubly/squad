@Lead and Team, this is the Phase B replay session for piece 50 of the upstream stack.
Phase A staged the piece 50 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 50 this session. No PR creation in Phase B. Piece 50 continues the stack past
piece 49 from a dogfooding pass that ran a **subfolder-hosted, multi-squad host** (each squad's team
root nested at `<callsign>/.squad/`) on a **self-hosted CI runner** and drove a real cross-developer
publish → fold → pull loop from a separate product clone. The fold loop is correct; these six gaps are
state-remote resolution, ref-cleanup hygiene, host-side hook root, self-install detection, doctor
accuracy, and runner-target ergonomics — each blocked or silently corrupted the subfolder-host /
self-hosted-runner configuration the cross-repo model already implies.

Working directory: `D:\git\squad-replay-fresh` (clone of akubly/squad).
- Branch to create: `squad/piece-50-subfolder-host-and-self-hosted-runner-hardening`
  off `squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding` (tip d64b0b1a)
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation.
- Work in an isolated git worktree so this session does not disturb other checkouts of the clone.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs
into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/43-cross-repo-state-remote-and-branch-resolution.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/46-state-remote-resolution-hardening-and-transport-coverage.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/47-monorepo-gitdir-and-sync-registry-robustness.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/48-host-operability-fold-cleanup-and-doctor-diagnostics.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/49-self-hosted-fold-runners-and-multi-squad-host-onboarding.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/50-subfolder-host-and-self-hosted-runner-hardening.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_planning/dogfood-backlog.md
```

If `50-subfolder-host-and-self-hosted-runner-hardening.md` does not exist on `akubly/upstream-specs`,
STOP immediately. Post a blocking comment asking the spec to be staged before this session proceeds.

`_planning/dogfood-backlog.md` is the roadmap context. The backlog's "Operational follow-ups" are host
administrative actions, NOT stack pieces — ignore them as implementation scope.

Piece 50 delivers five Tier-1 sub-proposals and one Tier-2 decision. A is cross-repo state-remote
resolution; B is CRLF-safe fold-ref cleanup (all four template copies); C is subfolder-aware host-side
hook root in `squad assign`; D is subfolder-aware `install-fold-pipeline` self-install; E is two
`squad doctor` subfolder-host accuracy fixes. A–E are Tier 1 (implement). F is a Tier-2 decision
(`install-fold-pipeline` self-hosted runner target) — triage it first and either implement F1
(`--runner "<labels>"`; **recommended**) or F2 (document-only) and record the rationale.

---

## Verify-first (before specifying or writing any change)

Confirm the actual code shape on the piece-49 base; do not assume signatures or line numbers.

- The cross-repo transport in `packages/squad-cli/src/cli/commands/sync.ts`: confirm
  `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` run git with `cwd = teamRoot`
  (piece 47's `git rev-parse --absolute-git-dir` resolution), and locate where the effective state
  remote is chosen from the registry entry's `stateRemote` and where `resolveRemote` (piece 46 §A) is
  defined. Confirm whether the configured `stateRemote` is validated against the team-root git context
  before use (the gap A closes).
- The four fold templates `packages/squad-cli/templates/fold/{ado,github}/fold-squad-state.yml` and
  their `packages/squad-sdk/templates/fold/{ado,github}/fold-squad-state.yml` mirrors: confirm the
  `--delete-folded-refs` cleanup loop shape (`jq -r '.[].ref'` → `while IFS= read -r REF` →
  `git push origin --delete`), and that `$FOLDED_ENTRIES` is the only set cleaned (piece 48 §B).
  Locate the canonical template source and the template-sync script — edit the canonical copy and
  re-sync; do not hand-edit four files.
- `squad assign` warm-path host-side hook installer in `packages/squad-cli/src/commands/assign.ts`
  (note: `commands/`, not `cli/commands/`): confirm the host git root is currently derived as
  `path.dirname(entry.path)` and passed to the cross-repo hook installer (piece 45), and that
  piece 49 §C resolves the team root but did not update this derivation. Confirm the cold-start
  (URL-only) hook path (if any) so C only touches the warm path.
- `installFoldPipeline` self-install in `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`:
  confirm piece 49 §D1's `.squad/`-at-repo-root detection and the `git rev-parse --show-toplevel`
  resolution, and the registry-entry → `dirname(entry.path)` → `stateLocation` fallback chain that
  precedes it.
- `squad doctor` in `packages/squad-cli/src/cli/commands/doctor.ts`: confirm `checkSquadAgentMd`
  resolves `.github/agents/squad.agent.md` against cwd, and locate the "Local `.squad/` directory
  found" advisory and how it consults the registry.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in
`.squad/decisions/inbox/piece-50-triage.md`.

| Sub-proposal | Tier | Decision |
|---|---|---|
| A — Cross-repo state-remote resolution in the team-root git context: use the registry `stateRemote` only when it exists in the team-root git context; else fall back to `resolveRemote(teamRoot)` (host clone origin); else fail with an error naming the host git root + remediation. Single-repo path unchanged. | Tier 1 | Accept |
| B — CRLF-safe fold-ref cleanup: `tr -d '\r'` + `REF="${REF%$'\r'}"` in the `--delete-folded-refs` loop (and defensively in the other refspec-feeding `jq \| while read` loops); all four copies byte-identical. | Tier 1 | Accept |
| C — `squad assign` host-side hook root: derive the host git root via `git rev-parse --show-toplevel` (cwd = resolved team root) instead of `dirname(entry.path)`, so a subfolder host installs the hook at the host git root. | Tier 1 | Accept |
| D — `install-fold-pipeline` self-install subfolder detection: also recognize a `<callsign>/.squad/team.md` subfolder host (not only root-level `.squad/`) and install at the git root; non-squad repos still fail fast. | Tier 1 | Accept |
| E — `squad doctor` subfolder accuracy: (E1) resolve `.github/agents/squad.agent.md` against `git rev-parse --show-toplevel`; (E2) suppress the local-`.squad/` advisory for a registered team root (incl. subfolder form). | Tier 1 | Accept |
| F — `install-fold-pipeline` self-hosted runner target: F1 `--runner "<labels>"` renders `runs-on: [<labels>]` + `defaults.run.shell: bash` for non-Linux labels (**recommended**) vs F2 document-only manual edit. | Tier 2 | Decide — record F1 or F2 with rationale |

Record the triage outcome in `.squad/decisions/inbox/piece-50-triage.md` before writing any product
code.

---

## Workflow for piece 50

**a.** Create the implementation branch off piece 49 (in a dedicated worktree):

```
git fetch origin
git worktree add -b squad/piece-50-subfolder-host-and-self-hosted-runner-hardening <worktree-path> squad/piece-49-self-hosted-fold-runners-and-multi-squad-host-onboarding
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-50-triage.md` before the
first product file is modified.

**c.** Implement TDD: write failing tests first, then implementation, red-to-green. A/C/D/E are
`packages/squad-cli/src` changes; B is the template edit (edit the canonical template source and
re-sync so all four copies stay byte-identical — do not hand-edit four files); F is the decided
`install-fold-pipeline` runner-target behavior. See implementation notes below.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > _scrub-gate-run.ps1
pwsh _scrub-gate-run.ps1
Remove-Item _scrub-gate-run.ps1
```

All gates must pass. Pre-existing WARN-level items are not blocking; confirm your changes contribute
**no new** hits (compare against the piece-49 base — the count must not grow). The stack's package
scope is `@bradygaster/squad-*`; keep it as-is — do not introduce any internal release scope into
clean files.

**e.** Add a changeset (REQUIRED — `packages/squad-cli/src` is touched by A/C/D/E/F):

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Because B modifies the `squad-sdk` fold-template mirror,
also select `patch` for `@bradygaster/squad-sdk`. Summary: "Cross-repo sync: resolve the state remote
in the team-root git context (fall back to the host clone's origin) with an actionable error; fold
templates: CRLF-safe `--delete-folded-refs` cleanup; `squad assign`: install the host-side hook at the
host git root for subfolder hosts; `install-fold-pipeline`: self-install detects subfolder hosts and
<F outcome>; `squad doctor`: resolve subfolder-host checks against the git root."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body: sub-proposals accepted (A–E and the F1/F2 outcome), triage outcome, scrub gate result,
and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-50-subfolder-host-and-self-hosted-runner-hardening
```

**h.** STOP. Do not open a PR. When the branch is pushed, report piece 50 complete.

---

## Implementation notes

### Gotchas (established by prior pieces)

- Use `npm install`, not `npm ci`.
- If a published `@bradygaster/squad-sdk` is nested under `packages/squad-cli/node_modules` and
  shadows the workspace source, remove it so the workspace source resolves.
- Validate per-package builds: `squad-sdk` first, then `squad-cli`. `npm run lint` is `tsc --noEmit`.
- Run heavy git-integration test files isolated
  (`npx vitest run <file> --no-file-parallelism --pool=forks --testTimeout=30000`) to avoid
  worker-contention timeouts (a trailing `onTaskUpdate` timeout with all tests passing is infra
  flakiness — the "Tests N passed" line is the signal).
- Revert incidental `package.json` / `package-lock.json` / build-stamp churn before committing. For B
  you DO intend to change the fold templates — edit the canonical source and run the template-sync so
  all four copies stay byte-identical; only revert *incidental* unrelated churn.
- Known pre-existing failures on this stack (piece-38 sync/publish J6/J7/M2/O6/N2/PM1/PM2 and assign
  P34.A1/A3) — confirm they remain unchanged; do not attribute them to piece 50. Classify every
  regression-sweep failure as pre-existing-on-base vs. caused-by-this-piece (run the same file on the
  piece-49 base worktree to confirm).

### Sub-proposal A — cross-repo state-remote resolution

Add a helper (near `resolveRemote`) that resolves the effective state remote in a given git context:
try the registry `stateRemote` first, guarded by `git -C <teamRoot> remote get-url <name>`; else
`resolveRemote(teamRoot)`; else throw a `SquadError` whose message names the host git root
(`git -C <teamRoot> rev-parse --show-toplevel`), the missing remote, and both remediations (add the
remote to the host clone, or clear the registry `stateRemote` to use the host clone's `origin`). Call
it from both `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` in place of the raw
`stateRemote` name. Tests: a cross-repo fixture whose host clone has only `origin` and (i) no
`stateRemote` set → resolves `origin`; (ii) `stateRemote` naming a remote present only in the product
clone → falls back to `origin`; (iii) `stateRemote` naming a remote that exists in the host clone →
uses it; (iv) neither resolvable → the actionable error naming the host git root. Single-repo tests
unchanged.

### Sub-proposal B — CRLF-safe fold-ref cleanup

Edit the canonical fold-template source and re-sync. Add `| tr -d '\r'` to the `jq -r '.[].ref'`
pipeline and `REF="${REF%$'\r'}"` inside the read loop; apply the same CR-strip to the other
refspec-feeding `jq … | while read` loops in the fold body. Tests: template-content assertions on all
four copies (the delete loop strips CR; four copies byte-identical within each platform). If the repo
has an executable fold-template harness (piece 41/42/48), add a multi-ref delete case whose ref list
is fed with CRLF line endings and assert every ref is deleted with no `invalid refspec`.

### Sub-proposal C — subfolder-aware host-side hook root

Replace `path.dirname(entry.path)` (as the host git root passed to the cross-repo hook installer) with
`git rev-parse --show-toplevel` run with cwd = the resolved team root (`entry.path`'s parent, i.e. the
team-root directory). For a root host this is `<hostRoot>`; for a subfolder host it is `<hostRoot>`
(not `<hostRoot>/<callsign>`). On failure (not a work tree), keep an actionable error sourced from the
git query. Tests (assign warm-path suite): a root-host fixture installs the hook at `<hostRoot>`
(regression); a subfolder-host fixture (`<hostRoot>/<callsign>/.squad`) installs the hook at
`<hostRoot>`; confirm the registered entry path and cold-start path are unchanged.

### Sub-proposal D — subfolder-aware self-install

In the piece-49 §D1 self-install branch, treat the current repo root as a valid self-install target
when the repo root holds `.squad/` **or** holds a `<callsign>/.squad/team.md` (the layout `init`
produces). Resolve and install at `git rev-parse --show-toplevel` in both cases (the fold pipeline is
repo-level and callsign-generic). Do not scan for arbitrary `*/.squad`. Tests: self-install inside a
subfolder host installs at the git root; inside a non-squad repo still fails fast with the `squad
assign` guidance; root-level `.squad/` host unchanged.

### Sub-proposal E — doctor subfolder accuracy

E1: resolve the `squad.agent.md` path against `git rev-parse --show-toplevel` (fallback to cwd when
not in a work tree). E2: before emitting the local-`.squad/` advisory, check the registry for an entry
whose team-root `path` matches the local `.squad/` (root or subfolder form); suppress the advisory
when registered, keep it for an unregistered stray. Tests: doctor run from a subdirectory of a
registered subfolder host emits neither finding; an unregistered stray `.squad/` still warns; a
root-hosted registered squad is unchanged.

### Sub-proposal D/F interaction and runner target — `install-fold-pipeline`

F1: add `--runner "<labels>"` (comma-separated). When present, render the GitHub template's `runs-on`
as a YAML sequence of the labels and, when the label set is not a Linux/ubuntu cloud image, inject
`defaults.run.shell: bash` at the job level so the POSIX fold body runs under Git-Bash. Absent the
flag, rendering is byte-identical to today. Keep the ADO template unchanged (agent-pool-driven).
Tests: `--runner "self-hosted,Windows,X64"` renders `runs-on: [self-hosted, Windows, X64]` +
`defaults.run.shell: bash`; no flag renders `ubuntu-latest` with no `defaults.run.shell`.
