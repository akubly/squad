# 36 — Cross-repo publish-loop defect repair

## Summary

Repair a cluster of wiring and transport defects that prevent the cross-repo assign→commit→publish→fold loop from functioning end-to-end. Each defect was surfaced during pre-dogfooding testing of the pieces 32–35 arc; none are theoretical — each produces a user-visible failure when the cross-repo flow is exercised against a realistic host repository.

Stack position: Part 36 of the cross-repo arc. Branches off piece 35 (`squad/piece-35-fold-pipeline-in-docs-repo`). Depends on pieces 32 (registry-first publication model), 33 (`publishTeamRootToInbox` wiring), 34 (automatic client-side publish triggers), and 35 (fold pipeline templates and `install-fold-pipeline` command) all being present on the branch.

Changeset requirement: `packages/squad-cli/src/` is touched — include a `patch` changeset entry for `@bradygaster/squad-cli`.

---

## Problem

The cross-repo assign→commit→publish→fold loop is not yet functional end-to-end. A developer who completes piece-35 setup and attempts to use the flow encounters the following user-visible failures:

1. `squad assign --developer-alias <alias> --state-remote <remote> --state-branch <branch>` silently ignores all three flags — they are never parsed, so the registry entry is never populated and the cross-repo hook is never installed.
2. `squad assign --skills-from <path>` is accepted at the CLI level but has no effect — the flag is parsed from the command line but never reaches the assign implementation.
3. A commit in the docs-repo clone fires the post-commit hook, which attempts `squad sync --push --quiet` — but the sync returns immediately without doing any work because an environment variable set by the hook itself signals "already running."
4. `squad sync --push` against a realistic host `.squad/` (containing `team.md`, `agents/`, `routing.md`, etc.) throws an error and aborts before publishing anything, because any path not on a short allowlist causes a hard throw rather than being skipped.
5. `squad install-fold-pipeline` fails with `✗ Template not found` from any npm-installed CLI because the template resolution path points to a directory that is not included in the published package.
6. `squad sync --dry-run --push` exits with an error about a missing developer alias even though dry-run was specifically designed to work before an alias is configured.
7. `squad sync --help` does not mention `--dry-run`, so users have no way to discover the flag.
8. `hydrateTeamRootFromStateRef` re-hydrates on every call even when `TEAM_ROOT` already matches the fetched orphan snapshot, because the idempotency comparison is structurally unsound.
9. Two `squad sync --push` calls within the same second from the same session produce an inbox branch name collision, causing the second push to fail.

---

## Proposed change

Sub-proposals A, C, D, and E are loop-blocking critical — the cross-repo flow cannot succeed without all four. Sub-proposals F, G, H, and I are correctness and hardening items. Sub-proposal B is a wiring gap that blocks a documented feature path. All sub-proposals are accepted for this piece.

### A. `squad assign` new flags never parsed or dispatched (CRITICAL)

**Current behavior:** `--developer-alias`, `--state-remote`, and `--state-branch` are absent from `NAMED_FLAGS` in `packages/squad-cli/src/commands/assign-args.ts:19`. They are not returned by `parseAssignArgs`, and are not destructured or forwarded in the dispatch block at `packages/squad-cli/src/cli-entry.ts:1309–1319`, even though `runAssign` is written to consume them at `packages/squad-cli/src/commands/assign.ts:546–548,584`. A call with any of these flags silently ignores them.

**Required behavior:** Add all three flags to `NAMED_FLAGS` in `assign-args.ts`. Return them from `parseAssignArgs`. Destructure and forward `developerAlias`, `stateRemote`, and `stateBranch` in the dispatch block in `cli-entry.ts`. Thread them into `runAssign`. Persist the resolved alias and state-remote/branch to the registry entry. Gate the cross-repo hook install (the `installCrossRepoHook` call from piece 34) on a resolved developer alias — if no alias is present, emit a warning and skip the hook install rather than exiting 1.

**Hard constraints:**
- `runAssign`'s existing behavior for calls without these flags must be unchanged.
- The registry entry written for a no-alias call must be identical to current behavior.
- The hook install gate is alias-present, not alias-non-empty-string — guard against both undefined and empty string.

**Test surface:** At minimum — (a) a test confirming all three flags reach `runAssign` when provided, (b) a test confirming the hook install is skipped (not errored) when no alias is supplied, (c) a test confirming the registry entry carries alias/stateRemote/stateBranch when all three are provided.

---

### B. `--skills-from` parsed but not forwarded

**Current behavior:** `--skills-from` is present in `NAMED_FLAGS` and is returned as `skillsFrom` by `parseAssignArgs`, but is not destructured in the dispatch block at `packages/squad-cli/src/cli-entry.ts:1309` and never reaches `runAssign`. Documentation describes it as functional.

**Required behavior:** Destructure `skillsFrom` in the dispatch block alongside the flags added in sub-proposal A. Forward it to `runAssign`. Behavior inside `runAssign` at `packages/squad-cli/src/commands/assign.ts` is already implemented; only the dispatch wiring is missing.

**Hard constraints:** No behavior change when `--skills-from` is absent.

**Test surface:** A test confirming `skillsFrom` reaches `runAssign` when provided on the command line.

---

### C. Cross-repo post-commit hook is a guaranteed no-op (recursion-guard bug) (CRITICAL)

**Current behavior:** The hook body written by `installCrossRepoHook` exports `SQUAD_SYNC_ACTIVE=1` before calling `squad sync --push --quiet` (`packages/squad-cli/src/cli/commands/install-hooks.ts:126–130`). When `squad sync --push --quiet` executes, `runSync` checks for `SQUAD_SYNC_ACTIVE` in the environment and returns immediately if it is set (`packages/squad-cli/src/cli/commands/sync.ts:597–600`). Because the hook pre-sets the variable before delegating to sync, every sync invocation from the hook returns without doing any work. The hook is a no-op in all configurations.

**Required behavior:** The hook body must NOT export `SQUAD_SYNC_ACTIVE=1` before calling `squad sync`. The guard in `runSync` exists to prevent nested git hooks from re-firing the hook inside an already-running sync. Let `runSync` own its guard: `runSync` sets `SQUAD_SYNC_ACTIVE=1` in the child environment when it spawns git operations that could re-trigger the post-commit hook, and clears or scopes it so the hook-invoked sync itself is not blocked. Alternatively, introduce a distinct nested-git suppression variable for the subprocess scope and reserve `SQUAD_SYNC_ACTIVE` for the `runSync`-is-running signal. The critical correctness requirement is: a commit in the docs-repo clone → hook fires → `squad sync --push --quiet` executes to completion.

**Hard constraints:**
- Infinite recursion (hook fires → sync commits → hook fires again) must remain impossible.
- The existing `SQUAD_SYNC_ACTIVE` tests must still pass or be updated to reflect the corrected semantics.
- The fix must not introduce a new environment variable that leaks into non-hook sync invocations.

**Test surface:** An end-to-end test that (a) installs the hook in a fixture docs-repo, (b) makes a commit, (c) asserts `publishTeamRootToInbox` was called (not merely that it did not throw), and (d) asserts a second commit triggered from within the sync execution does NOT result in a second `publishTeamRootToInbox` call. The existing guard test must be updated or supplemented to cover this scenario — a test that only checks for an early-return exit code without verifying that the hook-initiated path reaches publish does not constitute sufficient coverage.

---

### D. Publish allowlist aborts on any realistic host `.squad/` (CRITICAL)

**Current behavior:** `publishTeamRootToInbox` enumerates every file under `teamRoot/.squad/` and throws on the first path that is not on its allowlist (`packages/squad-cli/src/cli/commands/sync.ts:259–263,324–333`). The allowlist permits only a small set of subpaths. A real host `.squad/` directory — containing `team.md`, `config.json`, `agents/`, `routing.md`, `casting/`, `templates/`, and similar entries — always contains at least one path not on the allowlist. The result: `squad sync --push` against any realistic host throws before publishing and the user receives no useful output.

**Required behavior:** Change the hard-throw on a non-allowlisted path to a filter — skip non-allowlisted files when building the snapshot, never abort the whole publish. Treat the allowlist as the inclusion set: only files matching an allowlisted pattern are included in the snapshot; all other files are silently excluded. The publish still succeeds (with the allowlisted subset) even when the host `.squad/` contains paths not on the allowlist.

**Hard constraints:**
- The allowlist itself must not be widened in this piece. If additional paths need allowlisting, that is a separate spec decision.
- A `--verbose` or similar flag may log skipped files at debug level; never at warn or error level for expected host-repo files.
- The behavior of an empty or non-existent `.squad/` must remain unchanged (publish nothing; exit with an appropriate code or message).

**Test surface:** A publish test fixture that contains a realistic `.squad/` directory — at minimum `team.md` plus an `agents/` subdirectory — is required to lock in this behavior. The test must assert (a) the publish completes without throwing, (b) the snapshot contains only allowlisted paths, and (c) `team.md` is present in the snapshot (confirming it is on the allowlist).

---

### E. `install-fold-pipeline` template path breaks in the published package (CRITICAL)

**Current behavior:** `packages/squad-cli/src/cli/commands/install-fold-pipeline.ts:28` sets `TEMPLATES_ROOT = path.resolve(__dirname, '../../../../../.squad-templates')`. This path resolves correctly in a source checkout (where `.squad-templates/` is at the monorepo root) but resolves to a path that does not exist in the published package because `.squad-templates/` is not included in the `files` field of `packages/squad-cli/package.json`. Running `squad install-fold-pipeline` from an npm-installed CLI fails with `✗ Template not found`.

The actual shipped templates for the fold pipeline live at `packages/squad-cli/templates/fold/github/` and `packages/squad-cli/templates/fold/ado/` (package-local, included in `files`).

**Required behavior:** Resolve `TEMPLATES_ROOT` relative to the installed package by pointing to the package-local `templates/fold/` directory. In a compiled package, `__dirname` for `install-fold-pipeline.js` is inside `dist/cli/commands/`; a path like `path.resolve(__dirname, '../../templates/fold')` reaches the package-local templates. The source/dev checkout path must also continue to work — either by a fallback resolution or by ensuring the package-local path is also valid in the source tree.

**Hard constraints:**
- No modification to what is in the `files` field is needed if the package-local templates path is already included.
- The template content must not be duplicated — one authoritative copy, resolved at runtime.
- Idempotency behavior defined in piece 35 sub-proposal C must be preserved.

**Test surface:** A test that verifies template resolution succeeds when the runtime `__dirname` simulates a published-package layout (i.e., the monorepo root `.squad-templates/` path is not accessible). The existing idempotency tests from piece 35 must continue to pass.

---

### F. `squad sync --dry-run` unreachable in the cross-repo no-alias case

**Current behavior:** In `packages/squad-cli/src/cli/commands/sync.ts`, the alias-required guard at lines 677–684 runs before the `--dry-run` block at lines 689–703. When `--push --dry-run` is invoked without a configured developer alias in a cross-repo context, the alias guard exits 1 before the dry-run path is reached. The dry-run block itself contains a `'(alias required)'` placeholder, confirming the intended behavior was that dry-run works without an alias.

**Required behavior:** Move the `--dry-run` early-return ahead of the alias-required guard so that `squad sync --push --dry-run` can show the "what would publish?" preview before a developer alias is configured. The alias guard continues to block actual publish operations.

**Hard constraints:** The alias guard must still prevent actual publishes when no alias is configured.

**Test surface:** A test confirming `squad sync --push --dry-run` exits 0 and produces output when no developer alias is configured.

---

### G. `--dry-run` missing from `squad sync --help`

**Current behavior:** `--dry-run` is wired in `packages/squad-cli/src/cli-entry.ts:1445` but is absent from the help text block at `packages/squad-cli/src/cli/commands/sync.ts:329–344`.

**Required behavior:** Add `--dry-run` to the `--help` output for `squad sync`, with a brief description matching the behavior defined in sub-proposal F (print pending files and target inbox branch; do not publish).

**Hard constraints:** Help text style must match the existing help text for other flags in the same block.

**Test surface:** A snapshot or string-match test confirming `--dry-run` appears in `squad sync --help` output.

---

### H. `hydrateTeamRootFromStateRef` idempotency guard never fires

**Current behavior:** The idempotency guard in `hydrateTeamRootFromStateRef` compares the current `HEAD` SHA to the fetched orphan-snapshot SHA. In production, these values cannot match (HEAD is the working-branch tip; the orphan-snapshot is on a detached `squad-state` lineage), so the guard never short-circuits and the function always performs a full re-hydration.

**Required behavior:** Fix the comparison so the idempotent short-circuit triggers when `TEAM_ROOT` already matches the fetched state. The correct comparison should use the SHA of the last applied state snapshot (stored in a local sentinel file or passed through the registry entry) rather than `HEAD`. Implementation note: confirm the root cause during implementation — the audit rated this confirmed-medium. If the actual comparison operands differ from what is described here, record the finding in the triage decision doc and implement the corrected comparison.

**Hard constraints:**
- HEAD-safety (not clobbering uncommitted working-tree changes) must remain intact regardless of the idempotency fix.
- The idempotency guard is a performance optimization, not a correctness gate. If the comparison cannot be made reliable without a larger refactor, defer to a follow-up piece and record that decision.

**Test surface:** A test confirming the guard fires and re-hydration is skipped when the sentinel indicates the current state matches the fetched snapshot.

---

### I. Inbox branch-name collision on sub-second same-session publishes

**Current behavior:** The inbox branch name uses the format `squad/inbox/<alias>/<yyyyMMdd-HHmmss>-<sessionId>`. With a fixed session id and two publishes within the same wall-clock second, the branch name is identical and the second non-`--force` push fails.

**Required behavior:** Harden branch-name uniqueness so that two publishes in the same second from the same session produce distinct branch names. Acceptable approaches include sub-second timestamp precision (milliseconds) or a monotonic counter appended to the session id segment. The chosen approach must produce names that still sort correctly by the timestamp-primary/session-secondary key used by the fold pipeline.

**Hard constraints:** Branch name format changes must remain compatible with the fold pipeline's trigger pattern (`squad/inbox/**`) and sort algorithm from piece 35.

**Test surface:** A test confirming two rapid sequential calls to the branch-name generation function produce distinct values.

---

## Acceptance

Piece 36 is complete when all of the following hold:

1. **Build exits 0.** `npm run build` completes without errors.

2. **Pre-existing tests pass.** All tests from pieces 32–35 continue to pass without modification (except as required by the corrected guard semantics in sub-proposal C).

3. **End-to-end loop test.** A test (or test sequence) exercises the full assign→commit→publish→fold path against a realistic `.squad/` fixture: `squad assign --developer-alias <alias> --state-remote <remote> --state-branch <branch>` → commit in docs-repo clone → hook fires → `publishTeamRootToInbox` completes → inbox branch created with allowlisted `.squad/` content. This test is explicitly required; a partial chain does not satisfy this criterion.

4. **Realistic `.squad/` publish fixture.** A test fixture containing at minimum `team.md` plus an `agents/` subdirectory is introduced. The fixture is used by the sub-proposal D test to confirm the non-aborting filter behavior.

5. **Per-sub-proposal coverage.** Each sub-proposal A through I has at least one targeted test.

6. **Changeset present.** A `.changeset/*.md` file records a `patch` bump for `@bradygaster/squad-cli` with a neutral summary of the defects repaired.

7. **Scrub gate passes.** `pwsh docs/proposals/upstream-bradygaster/_scrub-gate.ps1` exits 0 with all gates PASS (or pre-existing WARN baseline unchanged).
