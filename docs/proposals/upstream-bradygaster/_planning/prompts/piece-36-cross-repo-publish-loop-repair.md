@Lead and Team, this is the Phase B replay session for piece 36 of the upstream stack.
Phase A staged the piece 36 spec on the `akubly/upstream-specs` branch.
Phase B implements the accepted sub-proposals on their own branch, fully tested.
Phase C (later, separate sessions) opens the PRs against the upstream repository.

You implement piece 36 this session. No PR creation in Phase B.

Working directory: `D:\git\squad-replay` (clone of akubly/squad).
- Branch to create: `squad/piece-36-cross-repo-publish-loop-repair` off `squad/piece-35-fold-pipeline-in-docs-repo`
- origin → akubly/squad. Do NOT add other remotes.
- Upstream source material is not reachable from any git ref in this clone. Preserve that isolation — do not add remotes pointing to source material, do not browse other paths on disk.

Read these inputs in order before any work (use `git show` from the spec branch — do NOT copy specs into your working branch):

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/00-stack-overview.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/REPLAY-PROTOCOL.md
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/36-cross-repo-publish-loop-repair.md
```

If `36-cross-repo-publish-loop-repair.md` does not exist on `akubly/upstream-specs`, STOP immediately. Post a blocking comment asking the spec to be staged before this session proceeds.

Piece 36 repairs nine defects in the cross-repo assign→commit→publish→fold loop introduced by pieces 32–35. The loop is not functional end-to-end without these repairs. Piece 35 must be present on the base branch before implementation begins.

---

## Triage

Before any code changes, triage the sub-proposals below and record decisions in `.squad/decisions/inbox/`:

| Sub-proposal | Severity | Decision |
|---|---|---|
| A — `squad assign` new flags never parsed or dispatched | **CRITICAL** | Accept |
| B — `--skills-from` parsed but not forwarded | Normal | Accept |
| C — Cross-repo hook is a guaranteed no-op (recursion-guard bug) | **CRITICAL** | Accept |
| D — Publish allowlist aborts on any realistic host `.squad/` | **CRITICAL** | Accept |
| E — `install-fold-pipeline` template path breaks in published package | **CRITICAL** | Accept |
| F — `squad sync --dry-run` unreachable in no-alias case | Normal | Accept |
| G — `--dry-run` missing from `squad sync --help` | Normal | Accept |
| H — `hydrateTeamRootFromStateRef` idempotency guard never fires | Medium | Accept — confirm root cause during implementation; defer to follow-up if larger refactor needed |
| I — Inbox branch-name collision on sub-second publishes | Low | Accept (hardening) |

Record accept/defer/reject for each sub-proposal in a single `.squad/decisions/inbox/piece-36-triage.md` file before writing any product code.

---

## Workflow for piece 36

**a.** Create the implementation branch off piece 35:

```
git fetch origin
git checkout squad/piece-35-fold-pipeline-in-docs-repo
git checkout -b squad/piece-36-cross-repo-publish-loop-repair
```

**b.** Run triage (above). Record decisions in `.squad/decisions/inbox/piece-36-triage.md`. The triage document must exist before the first product file is modified.

**c.** For each accepted sub-proposal, implement TDD: write failing tests first, then implementation, red-to-green. All sub-proposals A through I are accepted per the triage table.

See implementation notes below for per-sub-proposal guidance.

**d.** Run the scrub gate before committing:

```
git show akubly/upstream-specs:docs/proposals/upstream-bradygaster/_scrub-gate.ps1 > scrub-gate.ps1
pwsh scrub-gate.ps1
Remove-Item scrub-gate.ps1
```

All gates must pass. Address any failures introduced by your changes. Pre-existing WARN-level baseline items are not blocking.

**e.** Add a changeset — `packages/squad-cli/src/` is touched:

```
npx changeset add
```

Select `patch` for `@bradygaster/squad-cli`. Summary: "Repair cross-repo publish-loop defects: wire assign flags, fix recursion guard, change allowlist throw to filter, fix template resolution, fix dry-run gate ordering."

**f.** Single squashed commit with the required trailer:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Commit body must list: sub-proposals accepted (A–I), triage outcomes, scrub gate result, and changeset classification.

**g.** Push the branch:

```
git push -u origin squad/piece-36-cross-repo-publish-loop-repair
```

**h.** STOP. Do not open a PR. Phase C handles PR opening as a separate, deliberate workflow.

---

## Implementation notes

### Sub-proposal A — Wire assign flags

Files: `packages/squad-cli/src/commands/assign-args.ts` and `packages/squad-cli/src/cli-entry.ts`.

Add `--developer-alias`, `--state-remote`, `--state-branch` to `NAMED_FLAGS` in `assign-args.ts` at the position consistent with existing named-flag declarations (line ~19). Return them from `parseAssignArgs` as `developerAlias`, `stateRemote`, `stateBranch`. In the dispatch block in `cli-entry.ts` at lines 1309–1319, destructure all three alongside existing fields and pass them to `runAssign`. The hook install gate in `runAssign` (`packages/squad-cli/src/commands/assign.ts:546–548,584`) must check for a truthy alias before calling `installCrossRepoHook` — warn to stderr and skip if absent, do not exit 1.

Write three tests: (a) all three flags reach `runAssign` when provided, (b) hook install is skipped without error when no alias is supplied, (c) registry entry carries the three new fields when all are provided.

### Sub-proposal B — Forward `--skills-from`

File: `packages/squad-cli/src/cli-entry.ts` dispatch block at line 1309.

`skillsFrom` is already returned by `parseAssignArgs`. Add it to the destructure and forward it to `runAssign`. One test: `skillsFrom` reaches `runAssign` when provided.

### Sub-proposal C — Fix recursion-guard bug

File: `packages/squad-cli/src/cli/commands/install-hooks.ts:126–130`.

Remove the `export SQUAD_SYNC_ACTIVE=1` line from the hook body. `runSync` in `packages/squad-cli/src/cli/commands/sync.ts:597–600` already guards against re-entry; the hook must not pre-set the variable before delegating. If `runSync` needs to set the variable in the subprocess environment for git operations it spawns (to prevent hook re-fire from within the sync), use `process.env` mutation or a spawn option — never export it in the hook preamble before the sync call.

Write an end-to-end test: (a) install the hook in a fixture docs-repo, (b) make a commit, (c) assert `publishTeamRootToInbox` was called, (d) assert a second commit triggered within the sync does NOT produce a second `publishTeamRootToInbox` call. Update any existing guard tests whose assertions were based on the pre-set variable behavior.

### Sub-proposal D — Filter non-allowlisted paths

File: `packages/squad-cli/src/cli/commands/sync.ts:259–263,324–333`.

Change the `throw` on a non-allowlisted path to a `continue` (or equivalent filter). Build the snapshot from allowlisted paths only; silently exclude everything else. Create a test fixture with a realistic `.squad/` directory containing at minimum `team.md` and an `agents/` subdirectory. Assert: (a) publish completes without throwing, (b) snapshot contains only allowlisted paths, (c) `team.md` is present in the snapshot.

### Sub-proposal E — Fix template resolution

File: `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts:28`.

Change `TEMPLATES_ROOT` to resolve relative to the package-local `templates/fold/` directory. In the compiled output, `__dirname` for `install-fold-pipeline.js` is inside `dist/cli/commands/`; `path.resolve(__dirname, '../../templates/fold')` reaches `packages/squad-cli/templates/fold/` at runtime. Verify this path is also valid in the source tree (it should be, since `packages/squad-cli/templates/fold/` exists). Write a test that verifies template resolution succeeds when the monorepo-root `.squad-templates/` path is not accessible.

### Sub-proposal F — Move `--dry-run` before alias guard

File: `packages/squad-cli/src/cli/commands/sync.ts`.

Move the `--dry-run` early-return block (lines 689–703) ahead of the alias-required guard (lines 677–684). Write a test confirming `--push --dry-run` exits 0 and produces output when no developer alias is configured.

### Sub-proposal G — Document `--dry-run` in help text

File: `packages/squad-cli/src/cli/commands/sync.ts:329–344`.

Add `--dry-run` to the help text block, styled consistently with the other flags. Write a snapshot or string-match test confirming `--dry-run` appears in `squad sync --help` output.

### Sub-proposal H — Fix idempotency comparison

File: containing `hydrateTeamRootFromStateRef`.

Confirm the root cause during implementation: identify what values are being compared and why they can never match. If the fix is a targeted one-line correction (wrong variable referenced), implement it. If the correct comparison requires storing an additional sentinel (e.g., last-applied snapshot SHA in a local file), implement that sentinel pattern. If a reliable fix requires a broader refactor outside this piece's scope, record the limitation in `.squad/decisions/inbox/piece-36-triage.md` and defer. Write a test confirming the guard fires when the sentinel matches the fetched snapshot.

### Sub-proposal I — Harden inbox branch-name uniqueness

File: the function or module responsible for generating the inbox branch name (referenced in piece 33 / `publishTeamRootToInbox`).

Append a millisecond component or a per-session monotonic counter to make the name unique below one-second precision. Ensure the name still matches the fold pipeline's trigger pattern `squad/inbox/**` and sorts correctly by the timestamp-primary key. Write a test confirming two rapid sequential calls produce distinct names.

### Test import specifiers

When writing new tests, align import specifiers for the SDK package with the import pattern already established in the existing test files on the base branch. Do not introduce a new package scope in test imports — check the existing `test/` files to confirm the expected specifier before writing new tests.

---

## Acceptance gate

Piece 36 is complete when:

1. **Build exits 0.** `npm run build` completes without errors.

2. **Pre-existing tests pass.** All tests from pieces 32–35 pass without modification (except guard tests updated per sub-proposal C).

3. **End-to-end loop test present and green.** A test exercises assign→commit→hook→publish against a realistic `.squad/` fixture and asserts `publishTeamRootToInbox` completes.

4. **Realistic `.squad/` publish fixture present.** Fixture contains at minimum `team.md` plus `agents/` subdirectory; used by sub-proposal D tests.

5. **Per-sub-proposal coverage.** Each sub-proposal A through I has at least one targeted test.

6. **Changeset present.** `.changeset/*.md` records a `patch` bump for `@bradygaster/squad-cli`.

7. **Scrub gate clean.** `pwsh docs/proposals/upstream-bradygaster/_scrub-gate.ps1` exits 0, all gates PASS or pre-existing WARN baseline unchanged.
