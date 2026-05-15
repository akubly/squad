# EECOM

> Environmental, Electrical, and Consumables Manager

## Summary

EECOM owns SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). Path-utils centralized as single source of truth for OS-aware path comparison logic. All 137 targeted tests GREEN. Decision merged to decisions.md. Future pieces (init fail-fast, assign, unassign, doctor) import from centralized path-utils module.

## Learnings

### Piece 08b — Lockout Cycle Closed (2026-05-14)

📌 **EECOM lockout cycle closed — Sims revision shipped.**

EECOM was locked out of the piece 08b revision cycle following FIDO's REJECT verdict on the original piece 08b commit `012d6d16`. Sims (Integration / E2E) accepted the revision owner role and addressed all 4 blocking gaps (consult setup-mode success test, `.gitignore` non-mutation assertions, `resolved` variable threading, assign-to-copilot scope decision). All 31 tests GREEN. Build CLEAN. Scrub gate baseline unchanged. Lockout cycle closure documented in orchestration log `2026-05-14T16-12-01-sims.md` and merged to decisions.md.

EECOM remains available for other pieces and sessions. Artifact-scoped lockout only.

### Piece 08b — Migrate user-action CLI commands to resolveSquad() (2026-05-14)

**Resolver guard placement:** For existing commands (`consult`, `link`), the guard belongs at the `cli-entry.ts` dispatch layer, NOT inside the command module functions. Guards inside `runConsult`/`runLink` would break existing unit tests that call those functions directly from temp dirs not in any registry.

**New commands take guard inside the module:** `assign-to-copilot` is a new command with no pre-existing callers, so its guard lives inside `runAssignToCopilot()` in `assign.ts`.

**Test isolation for "resolver failure" paths:** Tests running from TEST_ROOT (nested inside the main repo) fail because `findGitRoot(TEST_ROOT)` walks up and finds `D:\git\squad-replay\.squad/`. Fix: create a `.git` directory inside TEST_ROOT in `beforeEach` to stop the walkup. Then the resolver finds no `.squad/` at TEST_ROOT and correctly returns null.

**Existing test message drift:** When adding a resolver guard before `consult`, the error message seen by `consult.test.ts` changes from the old "no personal squad" to the new "No squad found." Update the existing test to expect the new message AND add `SQUAD_REGISTRY_PATH` pointing to an empty registry to ensure the resolver returns null reliably.

**`consult --status` bypass:** The `--status` flag must bypass the resolver guard at dispatch. Only setup and `--check` modes need resolver precondition. `--status` reads local `.squad/config.json` directly — no resolver needed.

**Scrub gate Gate 1 pre-existing:** `git ls-files` scans the full tracked tree. Strip-listed files from prior pieces (docs/_internal/, orchestration-log, etc.) are pre-existing baseline contamination from the development history. Not a piece-08b regression.

### Piece 07 — Register merges clones[] and origins[] (2026-05-14)

**Git root detection on Windows:** `git rev-parse --show-toplevel` returns forward-slash paths on Windows (e.g. `C:/git/repo`). The new `lib/git-root.ts` helper wraps the call with `path.normalize()` to convert to OS-native separators. This is critical because `upsertEntry` validates clone paths and the SDK's path-comparison logic is platform-aware.

**Test isolation: git root walking.** Test temp dirs created inside a git repo will have `getGitRoot(tempDir)` walk up and find the outer repo's `.git`. On this codebase, `D:\git\squad-replay` has both `.git` and `.squad/`, so inference succeeds unexpectedly. Fix: run `spawnSync('git', ['init', tempDir])` to create a local `.git` stop-point, so `getGitRoot` returns the temp dir itself, not the outer repo.

**Optional `--path` and inference chain:** When `path` is omitted, `inferSquadDir()` walks `getGitRoot(cwd)` looking for `<gitRoot>/<cwd-basename>/.squad` then `<gitRoot>/.squad`. If neither exists, it throws with a "Pass --path" message. Tests for the "no path, no .squad" case need a git-init'd temp dir AND no `.squad` subdirectory present.

**`'merged'` outcome must be in the exhaustiveness switch:** The TypeScript switch in `cli-entry.ts` had a `never` branch. Adding `'merged'` to the `RunRegisterOutcome` type required adding `case 'merged':` before the `default: never` branch, or the build fails with an exhaustiveness error.

**Scrub gate gate 1:** `git ls-files` scans the entire tracked tree, so strip-listed files from pieces 01-06 (casting, identity, orchestration-log templates) show as pre-existing failures. Per protocol, the scrub gate targets the PR-shaped diff (Phase C), not the full branch. Gate 1 failures inherited from prior pieces are not piece-07 regressions.

### Piece 07 Adversarial Review Outcome (2026-05-14)

**Lockout:** EECOM is locked out of the piece 07 revision cycle. The adversarial review returned REJECT 3/3 from Flight, FIDO, and CONTROL on independent blockers (state leak, test discipline, API surface). Per Reviewer Rejection Protocol, the author of a rejected artifact is locked out of the immediate revision. CONTROL assigned for revision.

### Piece 06 — Register installs coordinator agent file (2026-05-13)

**Template-path divergence:** The spec's file manifest lists `packages/squad-cli/templates/squad.agent.md` as the canonical template, but the existing repo ships the 94 KB coordinator template at `packages/squad-cli/templates/squad.agent.md.template` (used by `init`/`upgrade` via the template manifest). Rather than duplicating the file, the install helper in `register.ts` tries the unsuffixed path first (`squad.agent.md`) and falls back to `squad.agent.md.template`. This preserves the spec's functional intent — stamped coordinator file at `<home>/.copilot/agents/squad.agent.md` — without duplicating the large template source.

**Home-override seam:** `RunRegisterOpts.home` provides the override. `os.homedir()` is the default. Tests pass an isolated temp directory as `home`, so the real user home is never touched. The seam is local to the `runRegister` call site; it is not threaded through the install helper signature — instead `runRegister` resolves `home` and passes it directly to `installCoordinatorAgent(home)`.

**Best-effort failure shape:** The entire install block (template lookup, `mkdirSync`, `copyFileSync`, `stampVersion`) is wrapped in a single try/catch inside `installCoordinatorAgent`. On any error, `console.warn` emits the target path and the underlying error message, and `runRegister` returns normally. The registry write is already committed at that point and is not rolled back.

**Build-before-test:** The vitest test suite imports from compiled `dist/` output via package.json exports (e.g., `./commands/register` → `dist/commands/register.js`). Changes to TypeScript source must be compiled before tests pick them up. Workflow: implement → `npm run build` → `npx vitest run`.



Piece 05 review cycle complete; revision authored by CONTROL after FIDO/INCO rejection. Final commit 366dd6c8. Phase B done.

### Piece 04 revision — cross-case dedup test and S14b mechanical swap (2026-05-13)

The revision added S9b, the cross-case duplicate-path integration test, and swapped S14b from `registerEntry` to `upsertEntry`.

**S9b** (`rejects registry with case-variant duplicate paths on win32/darwin`): The registry's `normalisedPathKey` already lowercased paths on win32/darwin via `normCase`, so the implementation was correct. S9b went GREEN immediately with no impl change required. The test constructs two entries using `dir.toLowerCase()` and `dir.toUpperCase()` as the directory segment (keeping `alpha.squad` filename lowercase to satisfy the `.endsWith('.squad')` validation), then branches on `process.platform`: win32/darwin assert `toThrow(/duplicate.*path/i)`, linux asserts `not.toThrow()` (case-distinct paths are valid there). This is the canonical pattern for OS-aware registry path equality integration tests.

**S14b** (`warns when path does not exist at write-preparation time`): Pure mechanical swap — `registerEntry` → `upsertEntry`, label updated from "at register time" to "at write-preparation time" to match the surrounding vocabulary in the `upsertEntry()` describe block. No implementation change needed.

**Sanity sweep**: `registerEntry` appears in source at `registry.ts` (deprecated alias definition) and `index.ts` (re-export). In tests: the import line and `BC.1`. After the S14b fix, no internal non-BC test calls `registerEntry`. Zero additional fixes required.

**Commit structure**: impl commit amended to `c971b743`, Scribe housekeeping cherry-picked to `2a444c91`. Branch force-pushed with `--force-with-lease`.

### Piece 04 deferred findings — scope for pieces 05+ (2026-05-13)

Adversarial review identified deferred findings that affect follow-up pieces (init fail-fast, assign, unassign, doctor). See `.squad/decisions.md` under "### 2026-05-13: CAPCOM Review" and "### 2026-05-13: Path normalization safety checks as standard" for full list. Key items: spurious CLI changeset bump, scope creep on resolution-v2 re-exports, deprecated tag removal timeline, symlink collision warnings, write-path documentation. These are follow-up pieces' concerns; piece 04 is approved as-is.

### Adversarial review follow-up — piece 03 test hardening (2026-05-13)

Test patterns learned from piece 03 review: tautology tests pass regardless of behavior; real assertions required on platform branches. Empty array vs missing field are structurally distinct. Chain precedence tests need active git teardown. Fixture isolation in TMP requires .git marker inside TMP to avoid walking up to outer git root.

### Registry schema validator (2026-05-12)

SquadError lives in adapter/errors.ts. Registry validation uses ERROR severity + VALIDATION category. No exported path-key helper in SDK source. Tests import TypeScript via .js specifiers using project-local scratch dirs.

## Archive

Older learnings (prior to 2026-04-12) have been archived to history-archive.md for reference. See that file for Q1 2026 and earlier context including template sync patterns, cherry-pick conflicts, and loop command refactors.

### Piece 09 — watch/triage startup resolution (2026-05-15)

**State context contract:** `SquadStateContext` now carries the registry-aware `resolution` result. `resolveSquadState()` resolves squad identity first, then derives `paths` from `resolution.path` so both fields describe the same `.squad/` directory.

**Watch startup boundary:** `packages/squad-cli/src/cli/commands/watch/index.ts` uses `resolveWatchStartupSquadDir()` before platform adapter setup, monitor state paths, capability loading, and polling. The helper precedence is state context first, registry-aware resolver second, directory detection fallback last. Poll rounds reuse the captured `squadDirInfo` and do not resolve again.

**Triage surface:** `packages/squad-cli/src/commands/triage.ts` re-exports the watch runner as `runTriage`, with package export wiring in `packages/squad-cli/package.json`.

**Test pattern:** `test/cli/watch-triage-migration.test.ts` exercises startup resolution through the helper instead of entering the long-lived watch loop. Use an invalid `SQUAD_REGISTRY_PATH` with a valid `stateContext` to prove the context path wins without invoking another registry read.
