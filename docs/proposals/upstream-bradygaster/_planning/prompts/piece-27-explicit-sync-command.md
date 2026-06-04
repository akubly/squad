@Lead and Team, this is the Phase B replay session for piece 27 of the upstream-bradygaster effort.
Phase A staged piece 27 on the akubly/upstream-specs branch.
Phase B implements it on its own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 27 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: squad/piece-26-cross-repo-bind-config
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/23-explicit-sync-command.md
```

If `23-explicit-sync-command.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment on this session asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 27 turns the existing sync engine into a first-class CLI command and makes it config-driven for a docs/specs remote. It builds on the config shape from piece 26.

Scope:
- Wire `sync` into `packages\squad-cli\src\cli-entry.ts` help and dispatch (remove `sync` from `KNOWN_UNWIRED` in `test\cli-command-wiring.test.ts`).
- Add flags to `packages\squad-cli\src\cli\commands\sync.ts`: `--pull`, `--push`, `--both`, `--remote`, `--hydrate-only`, `--publish-only`, `--developer <alias>`. The `--developer <alias>` flag must reject a missing or empty alias with a clear, non-zero-exit error message before any git operations begin.
- Remote resolution order inside `sync.ts`: (1) CLI `--remote`, (2) `.squad/config.json` `stateRemote`, (3) literal `squad-docs`.
- Add `ensureStateRemote()` helper in `sync.ts` to enforce refspecs: `+refs/heads/squad-state:refs/remotes/<remote>/squad-state` and `+refs/heads/squad/inbox/*:refs/remotes/<remote>/squad/inbox/*`.
- Update hook templates in `packages\squad-cli\src\cli\commands\install-hooks.ts` so `post-merge`, `post-checkout`, and `post-rewrite` pull from the docs remote, not only the code remote.
- Tests: add `test\cli\sync-command.test.ts`; add `test\cli\install-hooks.test.ts`; update `test\cli-command-wiring.test.ts`.

Special scrutiny — hook-recursion guard: the recursion guard in `install-hooks.ts` must not regress. Before changing any hook template, verify the existing guard test passes on the piece-26 tip. If it is already red, record that as a pre-existing defect in `decisions/inbox/` and fix it as part of this piece. Do not proceed with hook changes while the guard is broken.

Workflow for piece 27
  a. `git checkout -b squad/piece-27-explicit-sync-command` (branch off squad/piece-26-cross-repo-bind-config)
  b. Verify-first: run the hook-recursion guard test on tip. If it is red, treat it as a pre-existing defect, record the finding, and fix before proceeding with any hook changes.
  c. Decompose into sub-units: (1) CLI wiring + flag parsing, (2) `ensureStateRemote()`, (3) hook template updates, (4) `--developer` validation. TDD each: failing test first, then implementation, red-to-green.
  d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > $env:TEMP\scrub-gate.ps1
pwsh $env:TEMP\scrub-gate.ps1
```

     All 6 gates must pass. Address any failures, do not bypass.
  e. Add a changeset — `packages\squad-cli\src\` is touched: `npx changeset add`
  f. Single squashed commit with the required Co-authored-by trailer:
        "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
     Commit body must list: flags added, remote resolution order, `ensureStateRemote()` added, hook templates updated, recursion guard status (pass or fixed), test files added/updated.
  g. `git push -u origin squad/piece-27-explicit-sync-command`
  h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.
