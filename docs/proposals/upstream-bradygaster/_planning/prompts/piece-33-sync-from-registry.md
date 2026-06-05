@Lead and Team, this is the Phase B replay session for piece 33 of the upstream-bradygaster effort.
Phase A staged piece 33 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 33 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-32-registry-state-fields
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/33-sync-from-registry.md
```

If `33-sync-from-registry.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 33 replaces `runSync`'s reliance on `.squad/config.json` (which does not exist in the registry-first topology) with resolution from the registry entry extended by piece 32. It also wires `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` — currently exported but never called from `runSync` — into the push and pull paths. Finally, it adds `SQUAD_DEVELOPER_ALIAS` as an env-var fallback in the alias resolution chain.

## Triage

Before any implementation, triage sub-proposals A–D as **accept / defer / reject** and record decisions in `.squad/decisions/inbox/copilot-piece-33-triage.md`. Sub-proposal A is non-deferrable. B and C depend on A. Defer/reject decisions must include one-line rationale.

| Sub-proposal | Description | Deferrable? |
|---|---|---|
| A | Replace config.json resolution with registry resolution in `runSync` | No — S0 |
| B | Wire `publishTeamRootToInbox` into push path | No — depends on A |
| C | Wire `hydrateTeamRootFromStateRef` into pull path | No — depends on A |
| D | Add `SQUAD_DEVELOPER_ALIAS` env-var fallback to alias chain | Yes — isolated from A/B/C |

## Verify-first probes

Run both probes before writing any code. If expected output does not match, record the deviation in `decisions/inbox/` and adjust implementation anchors before proceeding.

**Probe 1 — `publishTeamRootToInbox` existence and wiring status:**

```
node -e "
const s = require('fs').readFileSync('packages/squad-cli/src/cli/commands/sync.ts', 'utf8');
const piLine = s.split('\n').findIndex(l => l.includes('export async function publishTeamRootToInbox'));
console.log('publishTeamRootToInbox at line:', piLine + 1);
const rsLine = s.split('\n').findIndex(l => l.includes('export async function runSync'));
console.log('runSync at line:', rsLine + 1);
const called = s.split('\n').slice(rsLine, rsLine + 100).some(l => l.includes('publishTeamRootToInbox'));
console.log('publishTeamRootToInbox called from runSync:', called);
"
```

Expected: `publishTeamRootToInbox at line: <N>` (N > 0), `called from runSync: false`. If N is 0, piece 28 has not merged — STOP.

**Probe 2 — `hydrateTeamRootFromStateRef` existence and wiring status:**

```
node -e "
const s = require('fs').readFileSync('packages/squad-cli/src/cli/commands/sync.ts', 'utf8');
const hLine = s.split('\n').findIndex(l => l.includes('export async function hydrateTeamRootFromStateRef'));
console.log('hydrateTeamRootFromStateRef at line:', hLine + 1);
const rsLine = s.split('\n').findIndex(l => l.includes('export async function runSync'));
const called = s.split('\n').slice(rsLine, rsLine + 100).some(l => l.includes('hydrateTeamRootFromStateRef'));
console.log('hydrateTeamRootFromStateRef called from runSync:', called);
"
```

Expected: line N > 0, `called from runSync: false`. If N is 0, the pull-path hydration function has not yet been implemented — STOP and confirm the prerequisite piece is merged.

## Workflow for piece 33

  a. `git checkout -b squad/piece-33-sync-from-registry` (branch off `squad/piece-32-registry-state-fields`)
  b. Run both verify-first probes. Record results. Only proceed if both functions exist and neither is called from `runSync`.
  c. Record triage decisions for sub-proposals A–D in `.squad/decisions/inbox/copilot-piece-33-triage.md`.
  d. Implement accepted sub-proposals using TDD — write failing tests first, then implement to make them green. Order: A → D → B → C (alias chain before push/pull wiring).

     **Sub-proposal A (registry resolution):**
     - Extend `test/cli/sync-registry-resolution.test.ts` (new file) with registry-match, no-match, and `SQUAD_TEAM_ROOT` override tests — all RED.
     - Add registry resolution logic to `runSync`: load registry via `loadRegistryFromDisk()`, match cwd to `clones[]` using `normalisedPathKey`, derive TEAM_ROOT as `path.dirname(entry.path)`.
     - Add config.json fallback for single-repo / unregistered contexts.
     - Add `detectBackend` disposition: either remove the call (derive backend from registry presence) or remove the function. Document in commit body.
     - Verify tests go GREEN.

     **Sub-proposal D (alias env-var fallback):**
     - Extend `test/cli/sync-command.test.ts` with alias resolution chain tests — all RED.
     - Add `process.env['SQUAD_DEVELOPER_ALIAS']` between `options.developer` and `registryAlias` in the resolution chain.
     - Verify tests go GREEN.

     **Sub-proposal B (wire publishTeamRootToInbox):**
     - Add integration test to `test/cli/cross-repo-sync.test.ts` asserting `squad sync --push` creates `squad/inbox/<alias>/<ts>-<sessionId>` on a bare-repo fixture — RED.
     - Add regression guard test: no registry entry → push falls back to `syncPush` (no inbox ref) — must be GREEN before and after.
     - Wire `publishTeamRootToInbox` into the `isPush` block: call when `teamRoot` is present, else fall back to `syncPush`.
     - SessionId: `process.env['COPILOT_SESSION_ID'] ?? randomUUID()`.
     - Verify integration test goes GREEN; regression guard stays GREEN.

     **Sub-proposal C (wire hydrateTeamRootFromStateRef):**
     - Add integration test to `test/cli/cross-repo-sync.test.ts` asserting `squad sync --pull` populates TEAM_ROOT sidecar — RED.
     - Add idempotency assertion: second pull is a no-op — RED.
     - Wire `hydrateTeamRootFromStateRef` after `syncPull` in the `isPull` block when `teamRoot` is present.
     - `stateBranch` defaults to `'squad-state'` when absent from registry entry.
     - Verify tests go GREEN.

  e. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate-run.ps1
pwsh scrub-gate-run.ps1
Remove-Item scrub-gate-run.ps1
```

     All gates must pass. Address any failures; do not bypass. Note: write the scrub gate script to the working directory, NOT to /tmp.

  f. Run the FULL test suite — not just touched files. Wiring fixes have wide blast radius:

```
npm test
```

     Confirm: piece 25.5's clean baseline is still green, and all new wiring tests pass. Document any pre-existing failures inherited from the parent branch (they are not a blocker, but must be noted in the commit body).

  g. Add a changeset — `packages/squad-cli/src/` is touched: `npx changeset add`
     Select `patch` for `@bradygaster/squad-cli`.

  h. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit message: `feat(sync): resolve TEAM_ROOT and state metadata from registry (piece 33)`
     Commit body must list:
     - Sub-proposals accepted and deferred/rejected (with one-line rationale each)
     - `detectBackend` disposition (call removed / function removed — which and why)
     - `publishTeamRootToInbox` line number confirmed by probe
     - `hydrateTeamRootFromStateRef` line number confirmed by probe
     - SessionId source: COPILOT_SESSION_ID env var or randomUUID()
     - Test files added/extended
     - Full test suite result (pass count or pre-existing failures documented)
     - Closes: (no issue — internal piece)

  i. `git push -u origin squad/piece-33-sync-from-registry`

  j. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.

## Acceptance gate

The following must all be true before considering piece 33 complete:

1. `runSync` does not read `WORK_ROOT/.squad/config.json` as its primary resolution source when a matching registry entry is present.
2. `SQUAD_TEAM_ROOT` env var overrides registry lookup.
3. Registry miss with no config.json fallback → exit 1 naming `squad assign`.
4. `squad sync --push` with matching registry entry calls `publishTeamRootToInbox`; without match, calls `syncPush`.
5. `squad sync --pull` with matching registry entry calls `hydrateTeamRootFromStateRef` after `syncPull`.
6. Alias resolution chain order: `--developer` flag → `SQUAD_DEVELOPER_ALIAS` env var → registry `developerAlias` → exit 1.
7. All new tests in `test/cli/sync-registry-resolution.test.ts` pass.
8. Integration tests in `test/cli/cross-repo-sync.test.ts` for push (inbox ref created) and pull (sidecar populated) pass.
9. Single-repo regression guard (no inbox ref when no registry entry) stays GREEN.
10. Full `npm test` run shows no new failures beyond the documented piece-32 parent baseline.
