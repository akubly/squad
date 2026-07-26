@Lead and Team, this is the Phase B replay session for piece 34 of the upstream-bradygaster effort.
Phase A staged piece 34 on the akubly/upstream-specs branch as a proposal set.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against bradygaster/squad.

You implement piece 34 this session. No PR creation in Phase B.

Working directory: D:\git\squad-replay (clone of akubly/squad).
- Currently on branch: `squad/piece-33-sync-from-registry`
- origin/dev is in sync with bradygaster/dev
- Single remote: origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/34-client-side-publish-triggers.md
```

If `34-client-side-publish-triggers.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment asking Flight to stage the spec before execution proceeds.

The "Tone & Record" section in REPLAY-PROTOCOL is binding for every file you write — including `.squad/agents/{name}/history.md` and `decisions/inbox/`. Future replay sessions read those files. No comparison framing, no version leaks, no fork residue.

Piece 34 ships three layered automatic publish triggers so developers do not need to run `squad sync --push` manually every session. It depends entirely on piece 33's wired push path (`publishTeamRootToInbox`). Piece 33 must be merged before implementation begins.

---

## Triage

Before any code changes, @Team must triage the three sub-proposals and record decisions in `.squad/decisions/inbox/`:

| Sub-proposal | Label | Decision required |
| --- | --- | --- |
| A — Git post-commit hook in docs-repo clone | accept / defer / reject | Primary automagic path. Accept unless blocking dependency on piece 33 push path is unresolved. |
| B — Copilot CLI post-tool hook | **verify-first** | See verify step below before triaging. |
| C — Manual command quality-of-life (`--quiet`, `--dry-run`, `status`) | accept / defer / reject | Low-risk ergonomic surface. Accept unless piece 33 sync.ts flag parsing creates conflicts. |

### Verify-first probe for sub-proposal B

Before triaging sub-proposal B, run this investigation:

1. Search the codebase for any external Copilot CLI hook registration mechanism:
   ```
   grep -r "post-tool" packages/ --include="*.ts" -l
   grep -r "copilot.*hook\|hook.*copilot" packages/ --include="*.ts" -il
   ```
2. Check whether `~/.config/github-copilot/` or equivalent paths have any hook configuration surface.
3. Check the SDK's `packages/squad-sdk/src/hooks/index.ts` — note that `HookPipeline.addPostToolHook` is an **in-process** API for custom agents, NOT an external Copilot CLI hook. These are distinct surfaces.

**If an external Copilot CLI post-tool hook API is found:** accept sub-proposal B, register the hook scoped to `TEAM_ROOT/.squad/**` writes, add tests.

**If no external Copilot CLI post-tool hook API is found:** record the gap in `.squad/decisions/inbox/copilot-post-tool-hook-gap.md`. Ship sub-proposals A and C only. Add a `// TODO(piece-34-B): Copilot CLI external post-tool hook API not found at implementation time; deferred to follow-up piece` comment at the intended integration point (a stub location in `install-hooks.ts` or a new `hooks/copilot-cli-hook.ts`). Document the skip in `test/cli/install-hooks.test.ts` with: `// Sub-proposal B deferred: Copilot CLI external post-tool hook API not available at implementation time`.

Record the B triage outcome (implemented or gap-documented) in `.squad/decisions/inbox/` before committing.

---

## Workflow for piece 34

a. `git checkout -b squad/piece-34-client-side-publish-triggers` (branch off `squad/piece-33-sync-from-registry`)

b. Run triage (above). Record accept/defer/reject for each sub-proposal in `.squad/decisions/inbox/`. Include B's verify-first result.

c. For each accepted sub-proposal, implement TDD: write failing tests first, then implementation, red-to-green in the same commit.

   **Sub-proposal A implementation notes:**
   - Add `installCrossRepoHook(docsRepoPath: string, options?: InstallHooksOptions): void` to `install-hooks.ts`. Target `docsRepoPath/.git/hooks/post-commit`, not CWD.
   - The `post-commit` hook template must check `SQUAD_SYNC_ACTIVE` (same variable used by existing hooks). If set to `1`, exit 0 immediately.
   - Modify `runAssignToCopilot` in `assign.ts`: when `opts.developerAlias` is provided, attempt `installCrossRepoHook` with the resolved docs-repo path. If docs-repo path is not available, emit a warning to stderr and continue — do not exit 1.
   - **Recursion guard is non-negotiable.** Before marking sub-proposal A done, run the guard fixture test: create a contrived test that would loop without the guard (a fake commit spawned inside a fake sync invocation), confirm the guard prevents re-entry.

   **Sub-proposal C implementation notes:**
   - Add `--quiet` flag to `squad sync --push`: suppresses stdout, never suppresses stderr.
   - Add `--dry-run` flag to `squad sync --push`: prints pending file list and target inbox branch; does NOT call `publishTeamRootToInbox`.
   - Add `squad sync status` subcommand: reads `.squad/.last-publish` (single ISO-8601 line); prints six fields (last published, pending changes, state remote, state branch, developer alias, docs repo path).
   - `squad sync --push` writes `.squad/.last-publish` on success.

d. Run the scrub gate before commit:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate.ps1
pwsh scrub-gate.ps1
Remove-Item scrub-gate.ps1
```

All gates must pass. Address any failures; do not bypass.

e. Add a changeset — `packages/squad-cli/src/` is touched:
   ```
   npx changeset add
   ```
   Select `patch` for `@bradygaster/squad-cli`. Summary: "Add automatic publish triggers: post-commit git hook in docs-repo clone, --quiet/--dry-run flags for squad sync --push, and squad sync status subcommand."

f. Single squashed commit with the required Co-authored-by trailer:
   ```
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```
   Commit body must list: sub-proposals accepted (A, B-if-found, C), sub-proposals deferred (B-if-not-found), recursion guard status (demonstrated via test), B triage outcome.

g. `git push -u origin squad/piece-34-client-side-publish-triggers`

h. STOP. Do not open a PR. Phase B is one piece per session — Phase C handles PR opening as a separate, deliberate workflow.

---

## Acceptance gate

Piece 34 is complete when:

1. **Piece 33 tests still green.** Run `npx vitest run test/cli/sync-command.test.ts` — all pre-existing piece 33 tests pass.

2. **New tests pass:**
   - `test/cli/install-hooks.test.ts` — cross-repo hook install, recursion guard fixture passes (the guard prevents re-fire; without the guard, the fixture would loop).
   - `test/cli/sync-command.test.ts` — `--quiet`, `--dry-run`, `status` subcommand tests pass.
   - `test/cli/assign.test.ts` — `developerAlias` triggers hook install attempt.

3. **Manual smoke test (docs-repo clone fixture):**
   - Create a bare git repository fixture representing the docs-repo clone.
   - Install the post-commit hook via `installCrossRepoHook`.
   - Run `git commit --allow-empty -m "smoke test"` in the fixture.
   - Verify that `squad sync --push` was invoked (stub the push path; assert the stub was called).
   - Verify that a second commit triggered by the stub does NOT re-invoke sync (recursion guard proof).

4. **Sub-proposal B outcome recorded** in `.squad/decisions/inbox/` (either hook registered and tested, or gap documented as follow-up piece).

5. **Scrub gate clean** (all gates pass, no new failures introduced).
