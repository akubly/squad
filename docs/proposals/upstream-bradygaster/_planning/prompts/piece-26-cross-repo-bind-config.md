@Lead and Team, this is the Phase B replay session for piece 26 of the upstream-bradygaster effort.
Phase A staged piece 26 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 26 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-25-resolver-rename-and-cli-hardening
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/22-cross-repo-bind-config.md
```

If `22-cross-repo-bind-config.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 26 normalizes the path/config model so cross-repo mode has a stable contract. Pieces 27–30 depend entirely on the config shape produced here.

Scope:
- Expand `SquadDirConfig` in `packages\squad-sdk\src\resolution.ts` with: `stateRemote?` (default `squad-docs`), `stateBranch?` (default `squad-state`), `inboxBranchPrefix?` (default `squad/inbox`), `developerAlias?`, `teamCachePath?`, `hydrateWorkRoot?`.
- Add `workRoot`, `workSquadDir`, `teamRoot`, `teamSquadDir` to the resolved shape returned by `resolveSquadPaths()`. Keep `projectDir` / `teamDir` as deprecated aliases — they must remain functional for one release and emit a deprecation warning on use.
- Add `runBind()` in new file `packages\squad-cli\src\cli\commands\bind.ts`: clones/updates the docs-repo sidecar, writes `.squad\config.json`, configures the `squad-docs` remote and refspecs in WORK_ROOT, updates `.git\info\exclude`, installs hooks.
- Wire `bind` into `packages\squad-cli\src\cli-entry.ts` help and dispatch. Update `packages\squad-cli\src\cli\commands\link.ts` and `init-remote.ts` to reference the renamed resolved fields.
- Tests: update `test\cli\init-remote.test.ts`; add `test\cli\bind.test.ts`; update `test\cli-command-wiring.test.ts` and `test\cli-packaging-smoke.test.ts`.

Constraint: **No `TODO` or placeholder may appear in the public surface of `SquadDirConfig` or `resolveSquadPaths()`**. The shape this piece produces is a contract; gaps become blocking defects for pieces 27–30.

Workflow for piece 26
  a. `git checkout -b squad/piece-26-cross-repo-bind-config` (branch off squad/piece-25-resolver-rename-and-cli-hardening)
  b. Decompose into natural sub-units: (1) expand config shape + deprecated aliases, (2) update resolved shape, (3) implement `runBind()`, (4) wire CLI dispatch, (5) update existing callers. Tackle in order — each sub-unit is a red-to-green TDD cycle.
  c. For each sub-unit: write failing test(s) that match the spec's acceptance criteria, then implement until green. Do not advance to the next sub-unit while any test is red.
  d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All 6 gates must pass. Address any failures, do not bypass.
  e. Add a changeset — `packages\squad-sdk\src\` and `packages\squad-cli\src\` are both touched: `npx changeset add`
  f. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit body must enumerate: new config fields added, resolved-shape fields added, deprecated aliases kept, new `bind.ts` command, test files added/updated.
  g. `git push -u origin squad/piece-26-cross-repo-bind-config`
  h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
