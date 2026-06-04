@Lead and Team, this is the Phase B replay session for piece 29 of the upstream-bradygaster effort.
Phase A staged piece 29 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 29 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-28-inbox-branch-publish-flow
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/25-team-root-work-root-protocol.md
```

If `25-team-root-work-root-protocol.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 29 updates the coordinator contract so agents know to read team state from TEAM_ROOT and edit code in WORK_ROOT. This is a protocol change that takes effect in all future sessions after the piece is merged.

Scope:
- Replace the current team-root path guidance in `.squad-templates\squad.agent.md` with an explicit four-path table:
  - `TEAM_ROOT` — docs/specs repo cache clone
  - `TEAM_SQUAD_DIR` — `{TEAM_ROOT}\.squad`
  - `WORK_ROOT` — product repo root
  - `WORK_SQUAD_DIR` — `{WORK_ROOT}\.squad` (projection/cache only; never canonical)
- Add explicit read/write rules to the coordinator template:
  - All `.squad\**`, charters, casting, routing, decisions, and logs are read and written from `TEAM_ROOT`.
  - Code search, edits, builds, and tests operate from `WORK_ROOT`.
  - Scribe and directive capture write only to `TEAM_SQUAD_DIR`.
  - Non-Scribe agents must never create or modify files under `WORK_SQUAD_DIR`.
  - Product git operations (`git push`, PRs, diffs) run in `WORK_ROOT`. State publication runs via `squad sync` against `STATE_REMOTE`.
- Add spawn-prompt contract: every spawned agent receives `TEAM_ROOT`, `WORK_ROOT`, `STATE_REMOTE`, `STATE_BRANCH`, and `DEVELOPER_ALIAS`.
- Mirror the canonical template to all copies via `scripts\sync-templates.mjs`:
  - `.github\agents\squad.agent.md`
  - `templates\squad.agent.md.template`
  - `packages\squad-cli\templates\squad.agent.md.template`
  - `packages\squad-sdk\templates\squad.agent.md.template`
- Tests: `test\template-sync.test.ts` must stay green. Add `test\team-root-work-root-protocol.test.ts` with lightweight assertions confirming the four-path table and write rules are present in the canonical template and all mirror copies.

Special scrutiny — session restart requirement: this piece changes the coordinator protocol. Any session that loaded the old `squad.agent.md` before this merge will behave under the old contract. The commit body must include an explicit restart-guidance reminder that operators/users must start a fresh session after pulling this piece.

Workflow for piece 29
  a. `git checkout -b squad/piece-29-team-root-work-root-protocol` (branch off squad/piece-28-inbox-branch-publish-flow)
  b. Triage: read the canonical `.squad-templates\squad.agent.md` and identify every place the current text assumes a single repo root. List them before editing. This triage does not need to be recorded in decisions/inbox/ unless you find a structural ambiguity requiring a judgment call.
  c. TDD: add `test\team-root-work-root-protocol.test.ts` first (red), then edit the canonical template to make it green, then run `scripts\sync-templates.mjs` to propagate mirrors, then confirm `test\template-sync.test.ts` stays green.
  d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All 6 gates must pass. Address any failures, do not bypass.
  e. No changeset needed — no `packages\*/src\` files are touched (template and test only). If any SDK/CLI source is incidentally modified, add a changeset: `npx changeset add`
  f. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit body must list: template sections changed, mirror copies updated, new test file, and — **required** — the following restart-guidance reminder: "Sessions loaded before this merge operate under the old coordinator contract. Start a fresh session after pulling this change."
  g. `git push -u origin squad/piece-29-team-root-work-root-protocol`
  h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
