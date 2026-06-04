@Lead and Team, this is the Phase B replay session for piece 30 of the upstream-bradygaster effort.
Phase A staged piece 30 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 30 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-29-team-root-work-root-protocol
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/26-ado-cross-repo-templates.md
```

If `26-ado-cross-repo-templates.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 30 ships the minimal Azure DevOps assets needed for enterprise deployment: one publish template, one fold template, and one bootstrap script. All are static files that wire the `squad bind` / `squad sync` surface to a real ADO environment.

Scope:
- Add three canonical templates under `.squad-templates\ado\`:
  - `bootstrap-cross-repo.ps1` — creates TEAM_ROOT sidecar clone, runs `squad bind`, configures `squad-docs` remote + refspecs, appends `.squad/` and `.github\agents\squad.agent.md` to `.git\info\exclude`, runs initial `squad sync --pull`. **Must be fully idempotent**: re-running on a configured machine must produce no errors and no duplicate remote/exclude entries.
  - `publish-inbox.yml` — publishes only inbox branches (`squad/inbox/<alias>/...`). **No PR trigger** (`pr:` key must be absent or explicitly `none`). Must not write to `squad-state`.
  - `fold-squad-state.yml` — triggered by `squad/inbox/*`; folds inbox branches into `squad-state` in deterministic order; stamps `.squad\publish-history.json`; fast-forwards `squad-state`; optionally prunes merged inbox refs. **This pipeline is the sole writer to `squad-state`** — the template must contain a comment asserting this invariant.
- Mirror all three via `scripts\sync-templates.mjs` to: `templates\ado\...`, `packages\squad-cli\templates\ado\...`, `packages\squad-sdk\templates\ado\...`.
- Docs: update `docs\src\content\docs\guide\shared-squad.md`, `docs\src\content\docs\features\state-backends.md`, and `docs\src\content\docs\scenarios\team-state-storage.md` to document the ADO deployment path, the TEAM_ROOT/WORK_ROOT setup, and the fold-pipeline invariant.
- Tests: extend `test\template-sync.test.ts` with existence assertions for each of the three `ado\` templates in all mirror locations. No PR trigger in `publish-inbox.yml` must be machine-checkable — add a YAML-parse assertion in the test suite.

Special scrutiny:
- **YAML validity**: both `.yml` files must be valid YAML. Run a YAML parse check before committing — a malformed template ships silently and breaks every pipeline that references it.
- **No-PR-trigger**: `publish-inbox.yml` must not contain `pr:` as a trigger key. The test assertion is the gate.
- **Sole-writer invariant**: `fold-squad-state.yml` must include a comment near the top stating it is the sole writer to `squad-state`. If any other template or script writes `squad-state`, that is a defect to be recorded in `decisions/inbox/` before proceeding.
- **Idempotency**: `bootstrap-cross-repo.ps1` must guard every mutation (remote add, exclude append, bind call) with an existence check.

Workflow for piece 30
  a. `git checkout -b squad/piece-30-ado-cross-repo-templates` (branch off squad/piece-29-team-root-work-root-protocol)
  b. Decompose into sub-units: (1) `bootstrap-cross-repo.ps1` (idempotent), (2) `publish-inbox.yml` (no PR trigger), (3) `fold-squad-state.yml` (sole-writer comment + fold logic), (4) template-sync mirror propagation, (5) docs updates, (6) test extensions. TDD for code-testable units; static-analysis assertions for YAML.
  c. For each sub-unit: write or extend the relevant test assertions first (red), then implement/write the template to make them green. YAML-parse assertions and the no-PR-trigger check are mandatory test gates — do not skip.
  d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All 6 gates must pass. Address any failures, do not bypass.
  e. No `packages\*/src\` changes are expected. If any are incidentally made, add a changeset: `npx changeset add`
  f. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit body must list: three template files added, mirror destinations confirmed, docs files updated, test assertions added (including no-PR-trigger and YAML-parse gates), idempotency guards confirmed, sole-writer comment location.
  g. `git push -u origin squad/piece-30-ado-cross-repo-templates`
  h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
