@Lead and Team, this is the Phase B replay session for piece 35 of the upstream-bradygaster effort.
Phase A staged piece 35 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 35 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-34-client-side-publish-triggers
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/35-fold-pipeline-in-docs-repo.md
```

If `35-fold-pipeline-in-docs-repo.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Coordinator to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

---

## Triage: accept/defer/reject before implementation begins

Piece 35 contains three sub-proposals. Triage each as accept / defer / reject and record decisions in `.squad/decisions/inbox/` before writing any code.

| Sub-proposal | Description | Classification |
|---|---|---|
| **A** | GitHub Actions `fold-squad-state.yml` at `.squad-templates/fold/github/` | S0 — non-deferrable. The GitHub Actions variant is required for the arc to be useful on GitHub-hosted docs repos (the most common case). |
| **B** | ADO Pipelines `fold-squad-state.yml` at `.squad-templates/fold/ado/` | S0 — non-deferrable. Constraint 1 from the architectural reset: repos may be on either GitHub or ADO. Shipping only one variant is not acceptable. |
| **C** | `squad install-fold-pipeline <github\|ado>` installer command | S1 — required for completeness. Without the installer, teams must manually copy the template, which creates deviation. Accept unless implementation reveals a blocker; defer is acceptable if B's complexity is higher than expected, but record the deferral explicitly. |

All three are expected to be accepted. The triage step exists to confirm no new information has emerged since Phase A that would change the classification.

---

## Verify-first probe

Run these probes BEFORE writing any implementation code. Confirm all expected values before proceeding. If an unexpected result appears, stop and record a blocking note in `.squad/decisions/inbox/` before continuing.

```bash
# 1. Confirm the fold algorithm source directory (will be created if absent)
ls .squad-templates/fold/ 2>/dev/null && echo "fold/ exists" || echo "fold/ absent — will be created"

# 2. Confirm yaml devDependency is available (was added in an earlier piece)
node -e "require('yaml'); console.log('yaml available')" || echo "yaml not available — add as devDependency"

# 3. Confirm install-fold-pipeline is not already wired in cli-entry.ts
grep -c 'install-fold-pipeline' packages/squad-cli/src/cli-entry.ts 2>/dev/null && echo "already wired" || echo "not yet wired"

# 4. Confirm piece 34 branch is the current base (all cross-repo foundation must be present)
git log --oneline -3

# 5. Confirm no existing fold template at the target locations
ls .squad-templates/fold/github/fold-squad-state.yml 2>/dev/null && echo "github template exists" || echo "github template absent"
ls .squad-templates/fold/ado/fold-squad-state.yml 2>/dev/null && echo "ado template exists" || echo "ado template absent"
```

Expected:
- `fold/` absent or empty → create it
- `yaml` available (if not, add `yaml` to devDependencies in package.json)
- `install-fold-pipeline` not yet wired → sub-proposal C will wire it
- Log shows piece-34 branch tip commits
- Both template paths absent → sub-proposals A and B will create them

---

## Workflow for piece 35

a. `git checkout -b squad/piece-35-fold-pipeline-in-docs-repo` (branch off squad/piece-34-client-side-publish-triggers)

b. Triage sub-proposals A, B, C. Record decisions in `.squad/decisions/inbox/copilot-piece-35-triage.md` before writing any code.

c. For each accepted sub-proposal, follow TDD: write failing test assertions first (RED), then implement to make them GREEN. Mandatory gates before moving to the next sub-proposal:
   - Sub-proposal A: `test/squad-templates/fold-github.test.ts` must be RED before template is written, GREEN after.
   - Sub-proposal B: `test/squad-templates/fold-ado.test.ts` must be RED before template is written, GREEN after.
   - Sub-proposal C: `test/cli/install-fold-pipeline.test.ts` must be RED before installer is written, GREEN after.

d. Sub-proposal A implementation checklist:
   - Create `.squad-templates/fold/github/fold-squad-state.yml`
   - Trigger: `push` to `squad/inbox/**` only. No `pull_request:`. No `workflow_dispatch:`.
   - Permissions block: `contents: write`, `actions: read`. No other permissions.
   - Single-writer invariant comment at top of `steps:` block: `# This pipeline is the sole writer to squad-state. No other automation or manual push should target this branch.`
   - Algorithm (in order): full-depth checkout → enumerate unfolded inbox refs via `git ls-remote` → filter against `publish-history.json` foldedRefs → sort by `<yyyyMMdd-HHmmss>` then sessionId → for each ref: `git read-tree` fold of `.squad/` subtree + commit → append fold record to `publish-history.json` → `git push origin HEAD:refs/heads/squad-state --force-with-lease` → optional `DELETE_FOLDED_REFS` cleanup.
   - Intermediate fold commits must use `publishedAt` from inbox snapshot metadata as commit timestamp, not pipeline run time.
   - No external product names or version numbers in comments.

e. Sub-proposal B implementation checklist:
   - Create `.squad-templates/fold/ado/fold-squad-state.yml`
   - Trigger: `trigger.branches.include: [refs/heads/squad/inbox/*]`. No `pr:`. No `schedules:`.
   - ADO checkout task with `fetchDepth: 0`.
   - OAuth scoped to push step only: no `allowScripts: true` at pool or pipeline level.
   - Single-writer comment: same verbatim string as sub-proposal A.
   - Algorithm identical to A; only ADO-specific runtime syntax differs (`$(System.AccessToken)` for token, ADO task syntax for checkout and script steps).
   - `DELETE_FOLDED_REFS` controlled by ADO pipeline variable with `default: false`.

f. Sub-proposal C implementation checklist:
   - New file: `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts`
   - Function signature: `installFoldPipeline(platform: 'github' | 'ado', options: InstallFoldPipelineOptions): Promise<void>`
   - Platform → target directory: `github` → `<docsRepoPath>/.github/workflows/`, `ado` → `<docsRepoPath>/.azure-pipelines/`
   - Fail fast (exit 1) if target directory does not exist.
   - Idempotency: if destination file exists and content matches template, exit 0 with no-op log.
   - Conflict guard: if destination file exists and content differs, exit 1 with actionable error message naming the path.
   - Wire dispatch in `packages/squad-cli/src/cli-entry.ts` as `install-fold-pipeline` subcommand.

g. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate-tmp.ps1
pwsh scrub-gate-tmp.ps1
del scrub-gate-tmp.ps1
```

All gates must pass. Address any failures — do not bypass. Note: if the ADO template introduces `$(...)` expressions, Gate 8 must pass (positive assertion: all `$(...)` expressions match `[A-Za-z][A-Za-z0-9._]*`).

h. Add changeset: `npx changeset add` — classify `@bradygaster/squad-cli` as `minor` (new `install-fold-pipeline` command). `@bradygaster/squad-sdk` is not modified.

i. Single squashed commit with the required Co-authored-by trailer:
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

   Commit body must list:
   - Sub-proposals accepted (A, B, C) or deferred (with rationale)
   - GitHub Actions template created at `.squad-templates/fold/github/fold-squad-state.yml`
   - ADO template created at `.squad-templates/fold/ado/fold-squad-state.yml`
   - Installer command wired at `packages/squad-cli/src/cli-entry.ts`
   - Single-writer comment location in both templates
   - `--force-with-lease` push guard confirmed
   - No `pr:` trigger in either template (confirmed by test assertions)
   - Changeset added for squad-cli minor

j. `git push -u origin squad/piece-35-fold-pipeline-in-docs-repo`

k. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.

---

## Acceptance criteria

Piece 35 is complete when ALL of the following are true:

1. `test/squad-templates/fold-github.test.ts` passes: YAML parses; trigger is `squad/inbox/**` push-only; no `pull_request:` key; `permissions.contents === 'write'`; single-writer invariant comment present.
2. `test/squad-templates/fold-ado.test.ts` passes: YAML parses; trigger includes `refs/heads/squad/inbox/*`; no `pr:` key; no `allowScripts: true` at pool level; single-writer invariant comment present.
3. `test/cli/install-fold-pipeline.test.ts` passes: correct template copied for `github` and `ado` args; idempotent re-run exits 0; conflicting file exits 1 with message naming the path; missing target directory exits 1.
4. Piece 34's tests still green (regression guard — piece 35 must not break the piece 34 surface).
5. Full test suite (`npm test`) passes or any failures are confirmed pre-existing on the piece-34 branch tip.
6. Scrub gate passes (all rules, no bypasses).
7. Manual smoke test: install the GitHub Actions variant into a local test directory that contains a `.github/workflows/` subdirectory. Verify `fold-squad-state.yml` appears at the expected path with correct content. Run the installer a second time; verify exit 0 and no file modification.
8. Changeset present in `.changeset/` classifying `@bradygaster/squad-cli` as `minor`.
