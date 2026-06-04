@Lead and Team, this is the Phase B replay session for piece 28 of the upstream-bradygaster effort.
Phase A staged piece 28 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 28 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-27-explicit-sync-command
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/24-inbox-branch-publish-flow.md
```

If `24-inbox-branch-publish-flow.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 28 splits the read path (pull from `squad-state`) from the write path (publish to `squad/inbox/<alias>/...`). Developer machines are read-only with respect to `squad-state`; the fold pipeline is the sole writer.

Scope:
- Add to `packages\squad-cli\src\cli\commands\sync.ts`: `hydrateTeamRootFromStateRef(teamRoot, remote, stateBranch)`, `hydrateWorkRootProjection(workRoot, teamRoot)`, `publishTeamRootToInbox(teamRoot, remote, inboxBranch)`.
- Publish branch format: `squad/inbox/<developerAlias>/<yyyyMMdd-HHmmss>-<sessionId>`.
- Snapshot payload: `.squad\decisions.md`, `.squad\decisions\inbox\**`, `.squad\log\**`, `.squad\orchestration-log\**`, `.squad\sessions\**`, `.squad\identity\**`. Shard session files as `.squad\sessions\<projectKey>\<workstream>\<sessionId>\...` to reduce fold conflicts.
- Add provenance file `.squad\publish-metadata.json` in each publish snapshot. Required fields: `developerAlias`, `sessionId`, `sourceWorkRoot`, `publishedAt`, `baseStateCommit`. **Do not include email addresses in any field** — use alias only (PII rule).
- Update `packages\squad-sdk\src\state-backend.ts` and `packages\squad-sdk\src\resolution.ts` as needed to reflect read/write split.
- Tests: add `test\cli\cross-repo-sync.test.ts` as an integration test using a bare-repo fixture. The fixture must prove: (a) two developers can publish concurrently without non-fast-forward conflicts, and (b) fold output can be pulled and hydrated by another clone. **This bare-repo fixture test is the acceptance gate — piece 28 is not done until it passes.**

Special scrutiny — concurrent publish and PII:
- The concurrent-publish race is the primary risk. The bare-repo fixture test is mandatory, not optional.
- `.squad/publish-metadata.json` must never contain email addresses. If any existing code captures `git config user.email`, replace it with `developerAlias` from config before this piece ships.

Workflow for piece 28
  a. `git checkout -b squad/piece-28-inbox-branch-publish-flow` (branch off squad/piece-27-explicit-sync-command)
  b. Decompose into sub-units: (1) hydrate helpers, (2) publish helper + branch naming, (3) provenance file (alias-only), (4) shard logic, (5) bare-repo fixture integration test. TDD each: failing test first, then implementation, red-to-green. Build the bare-repo fixture test in sub-unit 5 — it must be the final gate before commit.
  c. For each sub-unit: write failing test(s) against the spec's acceptance criteria, then implement until green. Do not mark done until the bare-repo concurrent-publish test is green.
  d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All 6 gates must pass. Address any failures, do not bypass.
  e. Add a changeset — `packages\squad-sdk\src\` and `packages\squad-cli\src\` are both touched: `npx changeset add`
  f. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit body must list: hydrate helpers added, publish helper added, branch format, provenance file fields (confirm no email), shard logic, test files added/updated, concurrent-publish fixture result.
  g. `git push -u origin squad/piece-28-inbox-branch-publish-flow`
  h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
