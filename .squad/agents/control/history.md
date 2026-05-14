# CONTROL

> Control System Engineer

## Learnings

### Issue Triage (2026-03-22T06:44:01Z)

**Flight triaged 6 unlabeled issues and filed 1 new issue.**

CONTROL assigned:
- **#481 (StorageProvider PRD)** → squad:control + squad:eecom (type system abstraction for runtime integration)

Pattern: State abstraction gap identified. StorageProvider defines canonical interface for data persistence across team.

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. CONTROL owns StorageProvider PRD specification (#481). Type system design critical for EECOM runtime integration. Ready to begin specification work on next sprint.
# Control — History

## Learnings

### Model Registry Architecture
- `MODELS` constant in `packages/squad-sdk/src/runtime/constants.ts` is the single source of truth for default model names and fallback chains. `DEFAULT_CONFIG` in `runtime/config.ts` derives `defaultModel` from `MODELS.DEFAULT`.
- `MODEL_CATALOG` in `packages/squad-sdk/src/config/models.ts` is the authoritative model list used by `ModelRegistry`. `DEFAULT_FALLBACK_CHAINS` in the same file mirrors `MODELS.FALLBACK_CHAINS` — both must stay in sync.
- `model-selector.ts` hardcodes task-to-model mappings for `code`, `prompt`, `visual`, `docs`, `planning`, `mechanical` task types. These must be updated alongside `MODELS.FALLBACK_CHAINS` when defaults change.

### Skill Templates Are Auto-Synced
- `npm run build` calls `scripts/sync-skill-templates.mjs` which copies `.squad/skills/*/SKILL.md` files into both `packages/squad-sdk/templates/skills/` and `packages/squad-cli/templates/skills/`. Editing `.squad/skills/model-selection/SKILL.md` is sufficient — the sync propagates it.

### Model Default Update Pattern
When updating default models, touch these files in order:
1. `.squad/skills/model-selection/SKILL.md` — tables, fallback chains, valid models list, examples
2. `.github/agents/squad.agent.md` — core rules section (~line 295), spawn example (~line 297)
3. `packages/squad-sdk/src/runtime/constants.ts` — `MODELS.DEFAULT`, `MODELS.FALLBACK_CHAINS`
4. `packages/squad-sdk/src/agents/model-selector.ts` — `selectModelForTask` switch cases
5. `packages/squad-sdk/src/config/models.ts` — `MODEL_CATALOG` entries, `DEFAULT_FALLBACK_CHAINS`
6. `packages/squad-sdk/src/runtime/benchmarks.ts` — fixture data
7. Tests: `test/agents.test.ts`, `test/config.test.ts`, `test/models.test.ts`, `test/compat-v041.test.ts`, `test/init.test.ts`

### Claude Haiku Stays at 4.5
There is no `claude-haiku-4.6`. The latest haiku is `claude-haiku-4.5`. Never bump haiku beyond 4.5 until the platform explicitly lists a newer haiku variant.

### Standard Tier Fallback Chain (current)
`claude-sonnet-4.6 → gpt-5.4 → claude-sonnet-4.5 → gpt-5.3-codex → claude-sonnet-4 → gpt-5.2`

### ModelId Type
`ModelId = string` in `runtime/config.ts` — not a discriminated union. New model IDs can be added to the catalog without TypeScript changes beyond the catalog and chain arrays.

### Template Copy Rename Pattern (#613/#614)
- Template copies of `squad.agent.md` in `templates/`, `packages/squad-cli/templates/`, and `packages/squad-sdk/templates/` are now named `squad.agent.md.template` to prevent Copilot CLI 1.0.11 from discovering and merging them as `*.agent.md` files.
- The canonical source (`.squad-templates/squad.agent.md`) and the active copy (`.github/agents/squad.agent.md`) remain unchanged.
- `scripts/sync-templates.mjs` handles the rename: mirror targets get `.template` suffix, `.github/agents/` target keeps `.md`.
- All code reading templates for init/upgrade/consult (SDK `init.ts`, CLI `upgrade.ts`, CLI `templates.ts`, SDK `consult.ts`) references `squad.agent.md.template` as the source filename.
- The `TEMPLATE_MANIFEST` in `templates.ts` uses `source: 'squad.agent.md.template'` but `destination: '../.github/agents/squad.agent.md'` — source and target names differ.

### Piece 02 — Worktree-local + callsign resolver (2026-05-12T18:21:27-07:00)

**What was built:**
Added `packages/squad-sdk/src/resolution-v2.ts` implementing a new two-step squad resolution function — `resolveSquad(opts: ResolveOpts): ResolvedSquad | null` — exposed via the `./resolution-v2` package subpath.

**Resolution priority order:**
1. `opts.callsign` (explicit flag) — registry lookup, returns `source: 'env'`
2. Worktree-local — walk up from `opts.cwd` to the `.git` root, check for `.squad/` directory, returns `source: 'local'`
3. `SQUAD_CALLSIGN` env var — registry lookup, returns `source: 'env'`

**Key types:**
- `ResolveOpts` — `cwd`, `env`, `platform`, `homeDir`, `callsign`, `registryPath`
- `ResolvedSquad` — `path`, `source: 'local' | 'env'`, `callsign?`, `matchedOrigin?: string | null`

Both types are re-exported from the SDK barrel (`src/index.ts`).

**Error behavior:** `SquadError` thrown on empty callsign, missing registry, unknown callsign, or stale path (registry entry points to non-existent directory).

**Registry path precedence:** `opts.registryPath` > `opts.env.SQUAD_REGISTRY_PATH` > platform default.

**Test surface:** `test/resolution-v2.test.ts` — 17 tests across three describe blocks covering all spec parity criteria: worktree-local resolution (2.1–2.6, Step 2), callsign resolution (1.1–1.6, Step 1), and priority rules (flag > env var, flag > local, env var > auto).

**Files touched:** `resolution-v2.ts` (new), `index.ts` (type re-exports), `package.json` (subpath export), `test/resolution-v2.test.ts` (new), two changesets (minor bumps for worktree-local and callsign features).

**Build:** TypeScript strict mode passes clean. Additive — existing `resolution.ts` callers are unaffected.

### Piece 02 Remediation Pass (2026-05-12T23:48:00-07:00)

**Scope:** Applied 9 review findings (fixes A–I) from FIDO/RETRO/Flight review decisions.

**Changes:**
- **Fix A** — Added `env: {}` isolation to all 6 worktree-local tests (2.1–2.6) to prevent `process.env` pollution.
- **Fix B** — New test: `opts.callsign = ''` throws `SquadError` with code `EMPTY_CALLSIGN`.
- **Fix C** — New three-way priority test: explicit `opts.callsign` wins over both worktree-local `.squad/` and `SQUAD_CALLSIGN` env var simultaneously.
- **Fix D** — Added `ResolveErrorCode` union type (`EMPTY_CALLSIGN | INVALID_CALLSIGN | REGISTRY_MISSING | REGISTRY_INVALID | UNKNOWN_CALLSIGN | STALE_PATH`). Updated `resolverError()` to require a `code` parameter stored in `context.metadata.code`. Updated error-path tests to assert specific codes. Re-exported `ResolveErrorCode` from `src/index.ts`.
- **Fix E** — Three new registry-path tests: `SQUAD_REGISTRY_PATH` env var path, platform default path (with `opts.platform`/`opts.homeDir`), three-way precedence (`opts.registryPath` wins).
- **Fix F** — Three new malformed-registry tests (truncated JSON, BOM-prefixed JSON, wrong schema). Production code wraps `parseRegistry()` errors in a try/catch → re-throws as `resolverError(..., 'REGISTRY_INVALID')`.
- **Fix G** — Renamed tautological test: "SQUAD_CALLSIGN env var wins over registry-based auto-resolution" → "SQUAD_CALLSIGN resolves via registry when no local .squad/ present".
- **Fix H** — Switched `statSync` → `lstatSync` in all three stat calls (cwdStat, squadPath stat, entry.path stat) to avoid following broken symlinks.
- **Fix I** — Added `const CALLSIGN_RE = /^[A-Za-z0-9_-]+$/` and `validateCallsign()` function. Invalid charset throws `INVALID_CALLSIGN`. Two new tests for `opts.callsign` and `SQUAD_CALLSIGN` paths.

**Test count:** 17 → 28 tests. All 28 GREEN.

**Key pattern:** Typed error codes go in `context.metadata.code` (per Flight decision) — NOT as a top-level `SquadError` property. `inputError()` is a separate internal helper for cwd/input validation errors that have no exported code.

### Piece 02 Adversarial Review — Team Verdict (2026-05-13T06:07:00Z)

📌 **Team update:** FIDO, RETRO, and Flight completed adversarial reviews of piece 02 (commit 68b4f379) before Phase C. **Verdict: CONDITIONAL (blocking issues) + CLEAR security + APPROVE WITH CONDITIONS (architecture).** FIDO identified 2 blocking test-isolation and coverage gaps (tests 2.4–2.5 inherit `process.env` when `opts.env` not set; `opts.callsign = ''` path untested) plus 5 should-fix gaps. RETRO recommends callsign character-set validation (non-breaking) with low current risk. Flight proposes two architectural decisions: (1) module-naming policy against `-vN` suffixes (rename `resolution-v2.ts` → `resolver.ts` in dedicated piece or document exception), (2) typed error codes on `SquadError` for downstream CLI discriminability. No breaking changes, no security blocking. Brady awaiting remediation routing — CONTROL not locked out. See `.squad/decisions.md` for full findings.

### Piece 06 Revision — Register Installs Agent (2026-05-14T10:51:52-07:00)

**Scope:** Quality refinement of the register-installs-agent feature — addressed all five findings
(1 BLOCKER, 3 MAJOR, 2 MINOR) from the Flight + FIDO adversarial reviews.

**Key patterns learned:**

1. **Symlink-safe file copy:** Before `copyFileSync`, call `lstatSync` (not `statSync` — avoids following symlinks) on the target path. If `stat.isSymbolicLink()`, call `unlinkSync` first. Wrap the lstat in a try/catch that re-throws unless the code is `ENOENT` (target not yet existing is fine). Pattern: check-unlink-copy, not copy-clobber.

2. **CLI-boundary output pattern:** Install helpers should return the resulting path (or `undefined`) rather than calling `console.log` internally. The CLI dispatch layer owns all user-facing output. Add an optional `agentInstalledAt?: string` field to the result type; the CLI emits the log only when that field is present. This pattern keeps helpers testable and output-controllable.

3. **EISDIR for portable write-failure tests:** `chmod 0o444` does not prevent writes on Windows. Pre-creating the target path as a *directory* causes `copyFileSync(src, dirPath)` to fail with EISDIR/ENOTDIR on all platforms, making the test portable without any OS guards.

4. **Warning assertion specificity:** A broad regex like `/\.copilot|warn/i` passes trivially on any warning message. Split into two assertions: one for the target path pattern (`/\.copilot[\\\/]agents[\\\/]squad\.agent\.md/`), one for the error class (`/EISDIR|ENOTDIR|EACCES|could not/i`). Both must match.

5. **CLI dispatch testability:** Exported `main` with an `argv` parameter is the clean approach for unit-level CLI tests, but requires guarding the auto-invocation at the bottom of cli-entry.ts. The simpler alternative — spawning `node dist/cli-entry.js` as a child process — avoids entry-point contamination and tests the real CLI surface. Adding a `--home` flag to the register dispatch exposes the `home` seam without modifying `os.homedir()` globally.

6. **Primary/fallback template coverage:** The `templatesDir?: string` injection point on `RunRegisterOpts` lets tests stage a fake templates directory containing only `squad.agent.md` (primary) or an empty directory (neither path), covering branches that the real templates directory cannot exercise.

**Git mechanics:** Used Option A (interactive rebase with automated `GIT_SEQUENCE_EDITOR` bat script). The rebase paused at the EECOM code commit; code changes were applied, amend committed, then `git rebase --continue` replayed the Scribe state commit on top. Stash was used to isolate build-artifact noise from the amend stage.

**Test counts:** 16 pass / 1 skipped (symlink on Windows without Developer Mode).

**EECOM lockout respected:** Did not read `.squad/agents/eecom/history.md` for implementation guidance. Reviewed only the committed code and reviewer findings.


**Scope:** Replaced EECOM's rejected commit `0488acaa` with clean revision `366dd6c8` addressing all ~25 blocking items from FIDO/INCO adversarial review.

**Key patterns learned:**

1. **Dual-module coexistence:** Two separate doctor modules exist: `src/cli/commands/doctor.ts` (legacy, `DoctorCheck[]`) and `src/commands/doctor.ts` (piece-05, `RunDoctorResult`). Package exports map them to distinct subpaths. Tests must use the correct import path.

2. **Help text regression surface:** Acceptance tests (`test/acceptance/features/*.feature`) assert specific description strings in `squad help` output. When trimming help text, every command listed must keep its full description matching the feature file expectations.

3. **Resource contention flakes:** Under full-suite load, 6+ tests fail from timeouts and ENOTEMPTY errors (resolution-v2, state-backend, init-scaffolding, journey-error-handling). All pass solo. These are NOT caused by piece-05 changes — they're a known flake class from temp-dir cleanup races.

4. **Shared helper extraction:** `_registry-path.ts` centralizes registry path resolution with unified precedence: explicit > env override > process.env > platform default. The `_` prefix signals internal-only (no subpath export).

5. **Severity typing without casts:** Using `let severity: Severity = 'info'` with conditional reassignment avoids EECOM's `{ severity: 'info' as Severity }` box pattern that required unsafe `as` casts.

**Verification gates:**
- 83 in-scope tests: ALL PASS (32 original + 16 legacy doctor + 35 new)
- 4 regression tests: ALL PASS (speed-gates, ux-gates, e2e-shell, init-scaffolding)
- 29 acceptance tests: ALL PASS (including consult/extract help text)
- Build: CLEAN
- Full suite: 15 failures, all pre-existing flakes (pass solo)

### Piece 07 Revision — Register Merges Clones/Origins (2026-05-15)

**Scope:** CONTROL-led revision of EECOM's rejected piece 07 commit. All three reviewers (Flight, FIDO, CONTROL) issued REJECT verdicts. EECOM locked out for this cycle. CONTROL revised independently.

**Five blockers resolved:**

**B1 — Strip `.squad/` from product commit (Flight)**
EECOM's original commit `a1e82411` included `.squad/agents/eecom/history.md` inside the product commit. Technique used: hard-reset to piece 06 base (`5a0d626f`), then `git checkout a1e82411 -- <product files>` to surgically restore only the 7 product files (no `.squad/` paths), then commit clean as `9c3f0885`. The two Scribe commits were cherry-picked on top. Avoided interactive rebase entirely — reset + selective checkout + cherry-pick is a cleaner approach when the goal is simply removing a file from a commit.

**B2 — Path-uniqueness conflict guard (Flight)**
The prior code only guarded against same-callsign-different-path conflicts. Added a second guard: if a different callsign already claims the same squad path, `runRegister` throws `SquadError` with message `"<path> is already registered under callsign '<owner>'. Use --callsign <owner> to re-register."` This also eliminated the `'reactivated'` dead value — all same-path-different-callsign cases now throw before reaching that branch.

**B3 — Three failing dispatch-help tests (FIDO)**
Root cause: tests spawned the real CLI via child process and inherited `process.env`, which on the dev machine contained `SQUAD_REGISTRY_PATH` pointing to a real registry with an existing callsign 'x'. So `squad register --callsign x` succeeded (merge) instead of failing, causing tests that expected error-exit to see exit 0.

Fix: extended `runCli` with an optional `cwd?: string` parameter (defaults to `TEST_ROOT`); all three affected tests now pass `cwd: nonGitTmpDir` (a temp dir outside any Git repo) AND `--registry-path <clean-nonexistent-file>`. The `--registry-path` flag is the critical isolation piece — it prevents the real registry from being consulted.

**B4 — `squad register --help` text (CONTROL)**
Updated usage line from `--path <dir> (required)` to `[--path <dir>]`. Added `--origin` and `--clone` flag descriptions to the help block. Removed the false `(required)` label.

**B5 — Nits (CONTROL)**
- `cloneIdx2` → `cloneArgIdx` (clearer name)
- `'merged'` log line converted to template literal with Unicode `→`
- `--origin`/`--clone` append modes converted from in-place mutation to spread-copy pattern, consistent with `mergeGitContext`
- Removed dead `case 'reactivated':` and `case 'already-active':` from the outcome switch
- `RunRegisterOutcome` narrowed from 4 values to `'registered' | 'merged'` — stronger typing, exhaustiveness check tighter

**Key decisions made (without consulting EECOM):**
- Kept "already registered" wording (not reverted to "already active") — more precise for the conflict-error caller context
- Chose spread-copy over preserving EECOM's in-place mutation — both are correct (entry is a reference), but spread-copy is the established pattern in the codebase
- Gate 1 pre-existing failure (pieces 01–06 casting/identity/orchestration-log templates) acknowledged and documented in commit message; not caused by piece 07

**Test surface:** 45 tests across 3 files — ALL PASS.
- `register-merge.test.ts`: 12/12 (includes new B2 path-uniqueness test)
- `register.test.ts`: 5/5
- `dispatch-help.test.ts`: 28/28 (all 3 previously-failing B3 tests now GREEN)

**Git shape:** Two product commits on top of piece 06 base: `9c3f0885` (clean product, zero .squad/ paths) then `9ac6cd81` (B2-B5 revision). Scribe state commits sandwiched between: `257421fd` + `3b891805`.
