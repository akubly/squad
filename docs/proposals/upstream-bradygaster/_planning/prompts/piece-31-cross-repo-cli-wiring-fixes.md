@Lead and Team, this is the Phase B replay session for piece 31 of the upstream-bradygaster effort.
Phase A staged piece 31 on the akubly/upstream-specs branch as a multi-sub-proposal fix set.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 31 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-30.5-scrub-gate-audit
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/31-cross-repo-cli-wiring-fixes.md
```

If `31-cross-repo-cli-wiring-fixes.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight/Procedures to stage the spec before execution proceeds. Do not infer the spec from context — the staged file is the binding contract.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue. No mention of "dogfood", "Handbook", or session deliberation in any committed file.

Piece 31 is a multi-sub-proposal fix piece. It closes five CLI wiring gaps identified by post-implementation review. Sub-proposal A is non-deferrable (S0). Sub-proposals B–E default to accept absent a strong concrete objection.

Scope:
- **A (non-deferrable):** Wire `publishTeamRootToInbox` into `runSync` push path when cross-repo config is detected (`teamRoot` set in config.json). Single-repo pushes continue through `syncPush`. SessionId source: `COPILOT_SESSION_ID` env var → `crypto.randomUUID()`.
- **B:** Write `stateBackend: 'orphan'` permanently to config.json in `runBind`; remove the temporary write/restore workaround at bind.ts lines 272–278.
- **C:** Call `hydrateTeamRootFromStateRef(absTeamRoot, remote, stateBranch)` in `runSync` pull path after `syncPull`, when `teamRoot` is present in config.
- **D:** Add `process.env['SQUAD_DEVELOPER_ALIAS']` as the second fallback in the alias resolution chain in `runSync` (after `--developer` flag, before persisted config).
- **E:** Apply `DEVELOPER_ALIAS_RE` validation in `runBind` before config.json is written; error message names `--developer-alias` flag; export the regex from sync.ts or move to a shared utility.
- All tests extend existing files (`test/cli/cross-repo-sync.test.ts`, `test/cli/bind.test.ts`, `test/cli/sync-command.test.ts`). No new test files.
- Changeset required — this piece modifies `packages/squad-cli/src/`.

Triage:
Sub-proposal A is **S0 — non-deferrable**. Do not record a defer/reject decision for A. Triage on A is accept only.
Sub-proposals B–E: triage each as accept / defer / reject. Record decisions in `.squad/decisions/inbox/` before implementation begins. Defer/reject sub-proposals are omitted from this piece but do not block it.
Record the triage decisions before writing any implementation code.

Verify-first probe before implementing sub-proposal A:
```
node -e "
const s = require('fs').readFileSync('packages/squad-cli/src/cli/commands/sync.ts', 'utf8');
const lineIdx = s.split('\n').findIndex(l => l.includes('export async function publishTeamRootToInbox'));
console.log('publishTeamRootToInbox at line:', lineIdx + 1);
const runSyncStart = s.split('\n').findIndex(l => l.includes('export async function runSync'));
console.log('runSync at line:', runSyncStart + 1);
const hasCall = s.split('\n').slice(runSyncStart, runSyncStart + 80).some(l => l.includes('publishTeamRootToInbox'));
console.log('publishTeamRootToInbox called from runSync:', hasCall);
"
```
Expected: `publishTeamRootToInbox` at ~line 812, `runSync` at ~line 425, called from runSync: `false`. If the line numbers have shifted significantly or `called from runSync` is already `true`, update line references in your triage notes before proceeding.

Workflow for piece 31:
  a. `git checkout -b squad/piece-31-cross-repo-cli-wiring-fixes` (branch off squad/piece-30.5-scrub-gate-audit; confirm that branch exists locally before creating piece-31 off it)
  b. Run the verify-first probe above. Confirm findings match before writing any code.
  c. Record triage decisions for A–E in `.squad/decisions/inbox/` (A is non-deferrable; B–E each get a line of rationale).
  d. For each accepted sub-proposal, implement TDD: write or extend the relevant test assertions first (RED), then implement the fix (GREEN). The tests must call `runSync` / `runBind` through their exported function interfaces — not `publishTeamRootToInbox` directly — for sub-proposals A and C.
  e. After all accepted sub-proposals are implemented and green, run the scrub gate:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All gates must pass, including gates 7, 8, and 9 added in piece 30.5. Address any failures; do not bypass.
  f. Run the FULL test suite — not just the modified files:
     ```
     npm test
     ```
     Sub-proposals B–E touch CLI wiring that existing tests may depend on. All tests must pass before proceeding to commit.
  g. Add a changeset (piece 31 touches `packages/squad-cli/src/`):
     ```
     npx changeset add
     ```
     Select `patch` for defect-fix releases. Description: "Fix five CLI wiring gaps in cross-repo sync/bind dispatch."
  h. Single squashed commit with the required Co-authored-by trailer:
     ```
     Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
     ```
     Commit body must list: which sub-proposals (A–E) were included and which were deferred/rejected with one-line rationale each; sessionId source chosen; confirmation that the temporary stateBackend write/restore in bind.ts was removed (if B accepted); confirmation that the single-repo `syncPush` fallback is still exercised by a regression guard test.
  i. `git push -u origin squad/piece-31-cross-repo-cli-wiring-fixes`
  j. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
