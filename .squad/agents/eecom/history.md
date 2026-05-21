# EECOM — Project History Summary

> Environmental, Electrical, and Consumables Manager

## SUMMARY: Template Contamination & Sync Patterns

Brady contamination fix (#977): template files (squad.agent.md, init-mode/SKILL.md) contained hardcoded "Brady" examples, causing LLMs to greet every user as "Brady" regardless of actual `git config user.name`. Fixed: replaced hardcoded "Brady" with generic `{user}` / `{name}` placeholders. Canonical sources: `.squad-templates/squad.agent.md`, `.copilot/skills/init-mode/SKILL.md`. Template sync (`node scripts/sync-templates.mjs`) propagates squad.agent.md to `.github/agents/` but NOT init-mode SKILL.md (lives in `.copilot/skills/`, not `.squad-templates/`). Required manual edits in both CLI and SDK package templates. Key distinction: only template files copied to user repos were changed; Brady references in project docs remain (legitimate project history).

## SUMMARY: Cherry-Pick & Rebasing Discipline

PR #942 rebase (2026-04-12): PR from tamirdresher's fork retargeted from `insider` to `dev`, causing 29 files diff when only 3 commits (4 files) were actual fix. Cherry-picked 3 fix commits onto clean branch from dev, resolved conflicts from insider-only files, dropped `escapeYamlValue` import and APM YAML generation (skill.ts doesn't exist on dev). Key lesson: expect modify/delete conflicts when cherry-picking from insider-based branch to dev. Always verify base assumptions—insider-only module imports must be dropped if source file doesn't exist on target.

## SUMMARY: Loop Command Implementation

Loop command PR #767 (2025-07-26 & 2025-07-25) fixed 6 issues across two rounds: (1) `teamRoot` derived from `workTreeRoot` but `.squad/` may live in main checkout when running inside worktree—now derives from `detectSquadDir().path`. (2) `generateLoopFile()` hardcoded 48-line scaffold inline, duplicating `templates/loop.md`—replaced with `readFileSync` reading from templates. (3) Docs said `gh` optional but code hard-requires `gh copilot`—updated prerequisites. (4) `execFile` buffered output but never printed it—users saw no Copilot output during loop rounds. (5) `loop.md` resolved relative to `dest` but execution used `teamRoot`, creating CWD mismatch in worktree scenarios. (6) Docs said `description` defaults `""` but code uses `"Squad Loop"`.

**Fixes:** teamRoot now uses `path.dirname(squadDirInfo.path)`. Template dedup via `readFileSync` with `import.meta.url` resolution. Updated prerequisites for `gh` + `gh copilot`. Streaming fix: added `.on('data')` listeners for real-time output. Worktree CWD: both file resolution and execution use same `teamRoot`. Docs: updated description default.

**Test pattern:** For mocked `node:fs` tests, use `vi.importActual<typeof import('node:fs')>('node:fs')` in `beforeAll` to read REAL template file, then `beforeEach` to set mock return value. Validates actual template while keeping tests deterministic.

## SUMMARY: State Backend Architecture (2026-05-15)

`feat/state-backend-global-996` is fork's heaviest code branch, landing in Squad-owned modules: `state-backend.ts`, `resolution.ts`, `presets/*`, CLI commands (`preset`, `sync`, `migrate-backend`, `install-hooks`). Concrete persistence model: `local`, `git-notes`, `external`, `orphan`, `two-layer`. Distinctive `git notes --ref=squad` backend anchored to repo root commit—novel for Squad, avoids branch-local state loss while staying git-native. Most other fork branches are incremental extensions; this one is unique architectural duplication risk if ignored. Integration priority: evaluate `feat/state-backend-global-996` as primary candidate before adding more squad-home / cross-machine state work to `dev`.

---

📌 **Team update (2026-05-15T22:45:19Z — Rally Familiarization Complete & Decisions Merged):** Four-agent familiarization sprint on Rally completed. Flight analyzed Rally relationship to Squad (committable in-repo vs. non-committable external), EECOM documented technical integration (GitHub CLI host/agent split, `.worktrees/` patterns), Network analyzed distribution implications, PAO developed positioning strategy. Decisions drafted and merged to `.squad/decisions.md`: Rally Relationship, EECOM Technical Notes, Squad/Rally Positioning. Orchestration logs written (flight/eecom/network/pao). Session log created. All Rally learnings captured. Scribe archived inbox files and committed team state. Squadron ready for next cycle.

## Learnings

### Template Brady contamination fix (#977) (2026-05-01)

**Context:** Template files (squad.agent.md, init-mode/SKILL.md) contained hardcoded "Brady" examples in greetings, routing examples, and comments. LLMs treated these as patterns, greeting every user as "Brady" regardless of their actual `git config user.name`.

**Fix:** Replaced all hardcoded "Brady" in template examples with generic `{user}` / `{name}` placeholders. Canonical sources: `.squad-templates/squad.agent.md` and `.copilot/skills/init-mode/SKILL.md`. Template sync (`node scripts/sync-templates.mjs`) propagated squad.agent.md to `.github/agents/` but did NOT sync init-mode SKILL.md to package templates — those required manual edits in both `packages/squad-cli/templates/skills/init-mode/SKILL.md` and `packages/squad-sdk/templates/skills/init-mode/SKILL.md`.

**Key distinction:** Only template files that get copied to user repos were changed. Brady references in project docs (history-hygiene, release-process, humanizer, architectural-proposals, reskill) are legitimate content about the project founder and were left unchanged.

**Pattern:** When fixing template contamination, verify which files are covered by `sync-templates.mjs` and which require manual propagation. The init-mode SKILL.md lives in `.copilot/skills/` (not `.squad-templates/`), so sync doesn't touch its package copies.

### PR #942 rebase — cherry-pick from insider-based fork branch (2026-04-12)

**Context:** PR #942 from tamirdresher's fork was retargeted from `insider` to `dev`, causing 29 files in the diff when only 3 commits (4 files relevant to dev) were the actual fix. Cherry-picked the 3 fix commits onto a clean `squad/942-rebase-type-safety` branch from dev, resolving conflicts where insider-only files (skill.ts, cross-package-exports.test.ts) didn't exist on dev. Dropped the `escapeYamlValue` import and APM YAML generation function from init.ts since skill.ts doesn't exist on dev. Opened #963 as the clean replacement, closed #942.

**Key lesson:** When cherry-picking from an insider-based branch to dev, expect modify/delete conflicts for files that only exist on insider. Always verify the base assumptions of each change — imports referencing insider-only modules must be dropped or adapted.

### Loop command: second-round review fixes (#767) (2025-07-26)

**Context:** Three Copilot review comments on PR #767: (1) `teamRoot` was set to `workTreeRoot` but `.squad/` may live in the main checkout when running inside a git worktree — should derive from `detectSquadDir().path`, (2) `generateLoopFile()` hardcoded the full loop.md scaffold inline, duplicating `templates/loop.md`, (3) docs said `gh` was optional but code hard-requires `gh copilot` unless `--agent-cmd` is passed.

**Fixes:**
1. **teamRoot:** Changed `const teamRoot = workTreeRoot` to `path.dirname(squadDirInfo.path)` — `.squad/`-relative operations now always use the directory where `.squad/` was actually found.
2. **Template dedup:** Replaced 48-line hardcoded template with `readFileSync` reading from `templates/loop.md`. Used `import.meta.url` + `fileURLToPath` to resolve the path from the compiled file (3 levels up to package root). Created `packages/squad-cli/templates/loop.md` since it was missing from the CLI package's templates dir.
3. **Docs:** Updated prerequisites to state `gh` + `gh copilot` are required by default, with `--agent-cmd` as the escape hatch.

**Test impact:** Tests mock `node:fs` globally, so `readFileSync` in `generateLoopFile()` needed mock setup. Added `beforeAll` using `vi.importActual('node:fs')` to read the REAL template file, then `beforeEach` to set the mock return value. This keeps tests validating the actual template content.

**Pattern:** When reading template files in code that has mocked `node:fs` tests, use `vi.importActual<typeof import('node:fs')>('node:fs')` in `beforeAll` to get real filesystem access for loading test fixtures.

### Loop command: streaming output, worktree CWD, docs alignment (#767) (2025-07-25)

**Context:** Copilot code review on PR #767 flagged three issues in the loop command: (1) `execFile` buffered stdout/stderr but never printed it — users saw no Copilot output during loop rounds, (2) `loop.md` was resolved relative to `dest` but execution used `teamRoot` (derived from `.squad/` parent), creating a CWD mismatch in worktree scenarios, (3) docs said `description` defaults to `""` but code uses `'Squad Loop'`.

**Fixes:**
1. **Streaming:** Added `.on('data')` listeners to `currentChild.stdout` and `currentChild.stderr` after `execFile` spawn. Since output streams in real-time, the callback no longer re-writes buffered stdout/stderr on error (would duplicate).
2. **Worktree CWD:** Introduced `workTreeRoot = path.resolve(dest)` and set `teamRoot = workTreeRoot`. Both file resolution and execution CWD now use the same root.
3. **Docs:** Updated `docs/src/content/docs/features/loop.md` description default from `""` to `"Squad Loop"`.

**Key file:** `packages/squad-cli/src/cli/commands/loop.ts` — `runLoop()` entry point (~line 302), `executeRound()` inner function (~line 427).

**Pattern:** When using Node's `execFile` for interactive/long-running child processes, always attach stream listeners for real-time output. The callback's `stdout`/`stderr` args are the same buffered content — writing both duplicates output.

### archiveDecisions() count-based fallback (#626) (2025-07-24)

**Context:** `archiveDecisions()` in `packages/squad-cli/src/cli/core/nap.ts` silently returned `null` when all `###` entries were <30 days old (`old.length === 0`), even if the file was well over 20KB. Active projects generating many decisions per session could hit 145KB+ — 35K tokens burned per agent spawn.

**Fix:** Added a count-based fallback after the age-based split. When `old.length === 0` and total file size exceeds `DECISION_THRESHOLD` (20KB), the fallback separates recent entries into dated vs undated, sorts dated by age (most recent first), keeps entries that fit under the threshold budget, and archives the rest. Undated entries are always preserved — they are foundational directives per Procedures' guidance.

**Key design choices:**
1. Undated entries (`daysAgo === null`) are never archived by the count-based fallback. They stay in `recent`.
2. Budget calculation accounts for header + undated entries + kept dated entries to guarantee the result fits under 20KB.
3. Entries are re-sorted into original document order after the split, so the output file preserves heading sequence.

**Tests:** Added 4 adversarial tests — 50 all-today entries >20KB, mixed dated/undated preservation, under-threshold no-op, exact-threshold boundary case.

**Pattern:** When a function has an early-return optimization (`if (old.length === 0) return null`), always consider whether the condition that triggered the function call (file size > threshold) can still be true when the early-return fires. If so, the early-return is a silent failure.

### Init scaffolding: casting dir + no-remote stderr (#579) (2025-07-18)

**Context:** `squad init` in a fresh `git init` repo (no remote) printed `error: No such remote 'origin'` to stderr and `squad doctor` reported `casting/registry.json` missing. Two independent bugs in `packages/squad-sdk/src/config/init.ts`.

**Fix 1 — Stderr leak:** Three `execFileSync('git', ['remote', 'get-url', 'origin'])` calls in `initSquad()` were missing `stdio: ['pipe','pipe','pipe']`. The try/catch caught the error but git's stderr still leaked to the console. Added stdio piping to all three call sites (lines ~713, ~732, ~1039).

**Fix 2 — Missing casting files:** The init flow created the `.squad/casting/` directory but never populated it. Added a scaffolding block after directory creation that copies `casting-policy.json`, `casting-registry.json`, and `casting-history.json` from SDK templates (with inline fallbacks). Respects `skipExisting` — never overwrites user files.

**Pattern:** When calling `execFileSync` for a git command inside a try/catch, always add `stdio: ['pipe','pipe','pipe']` to suppress stderr. The catch prevents a crash, but without piped stdio the error message still prints to the user's terminal.

### CLI Version Subcommand Pattern (2026-03-23 Release Incident)
**Context:** `squad version` returned "Unknown command: version" even though `squad --version` and `squad -v` worked fine. Classic "unwired command" bug but for a flag-to-subcommand gap rather than a missing import.

**Pattern:** When a CLI flag works (`--foo`) but the equivalent subcommand doesn't (`foo`), the fix is almost always a single condition addition in `cli-entry.ts`. No separate command file needed for trivial handlers — inline alongside the flag handler. Added `cmd === 'version'` to the existing `--version`/`-v` condition. Also added `version` to help text command list.

**Why inline works:** Trivial handlers that just print a value don't warrant their own module. Same output, same code path — no reason to split. Avoids adding a file the wiring test would require an import for. Precedent: `help` is also handled inline.

### `squad version` subcommand (2026-07-15)

**Context:** Running `squad version` returned "Unknown command: version" because the subcommand was never routed in `cli-entry.ts`, even though `--version` and `-v` flags worked fine. Classic "unwired command" bug class, but for a flag-to-subcommand gap rather than a missing import.

**Fix:** Added `cmd === 'version'` to the existing `--version`/`-v` condition in `cli-entry.ts` (line ~130). Also added `version` to the help text command list. No new file in `cli/commands/` needed — this is a trivial inline handler, same as `--version`. The wiring test is unaffected since there's no separate command file.

**Pattern:** When a CLI flag (`--foo`) works but the equivalent subcommand (`foo`) doesn't, the fix is almost always a single condition addition in `cli-entry.ts`. No separate command file needed for trivial handlers.

### Privacy scrub messaging + EPERM + gitignore parent coverage (#549) (2026-07-14)

**Context:** Upgrade footer message always said "Preserves user state" even when the email privacy scrub had run — a direct contradiction of what just happened. Two related issues in the same function: EPERM on read-only `.gitattributes` would crash the upgrade, and `.gitignore` would add redundant entries already covered by parent paths (e.g. `.squad/log/` when `.squad/` was already present).

**Fix:**
1. `upgrade.ts` — `ensureGitattributes` catches EPERM/EACCES and returns `[]` with a console.warn, graceful degradation.
2. `upgrade.ts` — `ensureGitignore` skips an entry when any existing line is a parent prefix of it.
3. `upgrade.ts` — Footer logic checks whether the email scrub actually ran; shows "Privacy scrub applied" or "Preserves user state" accordingly.
4. `test/cli/upgrade.test.ts` — Added EPERM test using `chmodSync` (fix: `chmodSync` was missing from the `fs` import — added it).

**Pattern:** When adding a new fs function to a test, always verify the named import list at the top of the test file. Missing named imports from `'fs'` produce `ReferenceError` at runtime, not at type-check time (if the test file isn't part of the main tsconfig).

📌 **Team update (2026-03-22T09-35Z — Wave 1):** Economy mode fully implemented: ECONOMY_MODEL_MAP + resolveModel() integration in SDK, `squad economy on|off` CLI command, `--economy` flag, 34 tests passing. PR #504 open for review. Soft dependency: #464 rate limit UX should offer economy mode as recovery. Next: Phase 1 of ambient personal squad (T1–T5, T19) — ready to start immediately after merging current work. Procedures wrote governance proposals for squad.agent.md — awaiting Flight review.
### Rate Limit UX (#464) (2026-03-20)

**Context:** Users hitting Copilot rate limits saw generic "Something went wrong processing your message." Squad hid the actual error. `squad doctor` reported nothing — useless to diagnose.

**Root cause:** The catch block in `shell/index.ts` line ~1119 always emitted `genericGuidance()` unless `SQUAD_DEBUG=1`. Rate limit errors never got special treatment despite `RateLimitError` existing in `adapter/errors.ts`.

**Fix:**
1. `error-messages.ts` — Added `rateLimitGuidance({ retryAfter?, model? })` and `extractRetryAfter(message)` utilities. Rate limit guidance shows clear message + recovery options (retry time, `squad economy on`, config.json model override).
2. `shell/index.ts` — Catch block now detects rate limits via `instanceof RateLimitError` OR regex on the raw message. Writes `.squad/rate-limit-status.json` on detection.
3. `doctor.ts` — Added `checkRateLimitStatus()` check. Reads status file and warns if rate limit was recent.
4. `test/error-messages.test.ts` — Added 11 new tests covering `rateLimitGuidance` and `extractRetryAfter`.

**Pattern:** Rate limit status written to `.squad/rate-limit-status.json` as `{ timestamp, retryAfter, model, message }`. Doctor reads it on next run. File is never deleted automatically — doctor marks it `pass` when > 4h stale.

**Import path for `RateLimitError`:** `@bradygaster/squad-sdk/adapter/errors` (subpath export, not in main barrel).

**PR:** #464 fix — squad/464-rate-limit-ux

### CLI Entry Point Architecture
cli-entry.ts is the central router for ~30+ CLI commands using dynamic imports (lazy-loading). Commands are routed via if-else blocks. Has a recurring "unwired command" bug class — implementations exist in cli/commands/ but aren't routed in cli-entry.ts. The cli-command-wiring.test.ts regression test catches this by verifying every .ts file in cli/commands/ is imported.

### ESM Runtime Patch
Module._resolveFilename interceptor in cli-entry.ts (lines 47-54) patches broken ESM import in @github/copilot-sdk@0.1.32 (vscode-jsonrpc/node missing .js extension). Required for Node 24+ strict ESM enforcement. Works on npx cache hits where postinstall scripts don't run.

### Lazy Import Pattern
All command imports use `await import('./cli/commands/xxx.js')` to minimize startup time. Copilot SDK is lazily loaded only when shell is invoked. All .js extensions required for Node 24+ strict ESM.

### CLI Packaging & Distribution
`npm pack` produces a complete, installable tarball (~275KB packed, 1.2MB unpacked). Package includes dist/, templates/, scripts/, README.md per package.json "files" field. Postinstall script (patch-esm-imports.mjs) patches @github/copilot-sdk for Node 24+ compatibility. Tarball can be installed locally (`npm install ./tarball.tgz`) and commands execute via `node node_modules/@bradygaster/squad-cli/dist/cli-entry.js`. Both squad-cli and squad-sdk must be installed together — cli depends on sdk with "*" version specifier. All 27+ CLI commands are lazy-loaded at runtime; `--help` validates command routing without executing full logic.

### Packaging Smoke Test Strategy
test/cli-packaging-smoke.test.ts validates the packaged artifact (not source). Uses npm pack + install in temp dir + command routing verification. Commands are expected to fail (no .squad/ dir) — test verifies routing only (no "Unknown command", no MODULE_NOT_FOUND for the command itself). Exception: node-pty is an optional dependency for the `start` command and MODULE_NOT_FOUND for node-pty is allowed. Windows cleanup requires retry logic due to EBUSY errors — use rmSync with maxRetries + retryDelay options, wrap in try/catch to fail silently since tests have passed.

### v0.8.24 Release Readiness Audit
CLI completeness audit (2026-03-08) confirmed: 26 primary commands routed in cli-entry.ts, all present in smoke test. 4 aliases (watch→triage, workstreams→subsquads, remote-control→rc, streams→subsquads). 3 aliases tested, 1 untested ("streams"). Packaging verified: dist/, templates/, scripts/, README.md in tarball; bin entry points to dist/cli-entry.js; postinstall script included and working. All 32 smoke tests pass. Package.json files array correct. npm pack output shows 318 files, 275KB packed. No missing command implementations. Optional dep (node-pty) handled correctly. Only gap: "streams" alias not in smoke test (routed correctly but test coverage incomplete). Confidence: 95% — all critical paths covered, minor alias test gap non-blocking.

📌 **Team update (2026-03-08T21:18:00Z):** FIDO + EECOM released unanimous GO verdict for v0.8.24. Smoke test approved as release gate. FIDO confirmed 32/32 pass + publish.yml wired correctly. EECOM confirmed 26/26 commands + packaging complete (minor gap: "streams" alias untested, non-blocking).

### Cross-Platform Filename and Config Fixes (#348, #356) (2026-03-15T05:30:00Z)

**Context:** Two cross-platform bugs broke Squad on Windows: (1) log filenames contained colons in ISO 8601 timestamps (illegal on Windows), (2) `.squad/config.json` contained absolute machine-specific `teamRoot` path.

**Investigation:**
- Searched SDK for all timestamp usage in filenames — found `safeTimestamp()` utility already existed but wasn't consistently used
- `comms-file-log.ts` (line 32) used inline `toISOString().replace(/:/g, '-')` instead of utility
- `init.ts` (line 612) wrote absolute `teamRoot` to config.json on every init
- Session-store already used `safeTimestamp()` correctly (line 71)

**Fixes:**
1. **Bug #348:** Updated `comms-file-log.ts` to import and use `safeTimestamp()` utility instead of inline timestamp formatting
2. **Bug #356:** Removed `teamRoot` field from config.json (can be computed at runtime via `git rev-parse --show-toplevel`)
3. Updated live `.squad/config.json` in repo to remove machine-specific path

**Pattern:** Centralized timestamp formatting in `safeTimestamp()` utility (replaces colons + truncates milliseconds). Windows-safe format: `2026-03-15T05-30-00Z` instead of `2026-03-15T05:30:00.123Z`.

**Test Impact:** All 150 tests pass. Communication adapter test doesn't validate specific filename format (structural test, not behavioral).

**PR:** #404 opened targeting dev.

### CastingEngine CLI Integration (#342) (2026-03-15T11:20:00Z)

**Context:** CastingEngine class (Issue #138, M3-2) existed in SDK with curated universe templates (The Usual Suspects, Ocean's Eleven) but was completely bypassed during `squad init`. LLM picked arbitrary names, and charter generation used regex-based `personalityForRole()` instead of template backstories.

**Investigation:**
- CastingEngine.castTeam() was never called in CLI flow
- coordinator.ts buildInitModePrompt() let LLM pick any universe without guidance
- cast.ts generateCharter() used fallback personality logic instead of engine data
- SDK exports two AgentRole types: broad one in casting-engine.ts, restrictive one in runtime/constants.ts

**Integration Strategy (Augment, Not Replace):**
- LLM still proposes roles and team composition (the beloved casting experience)
- CastingEngine augments with curated names when universe is recognized
- Mapping: "The Usual Suspects" → 'usual-suspects', "Ocean's Eleven" → 'oceans-eleven'
- Unrecognized universes (Matrix, Alien, etc.) preserve LLM's arbitrary names

**Implementation:**
1. Added `augmentWithCastingEngine()` in cast.ts to replace LLM names with engine characters
2. Updated coordinator prompt to suggest preferred universes (Usual Suspects, Ocean's Eleven)
3. Extended `generateCharter()` to use engine personalities/backstories when available
4. Attached `_personality` and `_backstory` to CastMember objects for charter generation
5. Role mapping: CLI role strings → engine AgentRole enum (lead, developer, tester, etc.)

**Type Import Pattern:**
- Import CastingEngine from `@bradygaster/squad-sdk/casting` (not main barrel export)
- Use casting-engine.ts AgentRole type (9 roles) not runtime/constants.ts (6 roles)
- Partial mapping: unmapped roles log warning and skip engine casting

**Tests:**
- Created test/casting-engine-integration.test.ts (5 tests, all pass)
- Validates augmentation for both universes, case-insensitive matching, fallback behavior
- All 45 existing cast-parser/casting tests still pass

**PR:** #417 opened targeting dev.


### PR #427 Cross-Fork Rebase (2026-03-15T21:00:00Z)

**Context:** PR #427 (PAO external communications Phase 1) conflicted with upstream/dev after team recast (#423 Usual Suspects → Apollo 13) and model updates. Cross-repo PR (diberry/squad → bradygaster/squad). Initial rebase attempts failed due to git worktree confusion — main worktree was checked out to a different branch, causing git checkout commands to silently switch to wrong branches.

**Problem:** Git commands (checkout, rebase) kept switching to unrelated branches (squad/agent-on-disk-concept, squad/320-fix-migration-guide-version-local) mid-rebase. Root cause: main worktree at C:\Users\diberry\repos\project-squad\squad was checked out to squad/agent-on-disk-concept. Git was treating checkout commands as worktree operations and switching the main worktree's HEAD, aborting the rebase.

**Solution:** Created dedicated worktree (.worktrees/pao-rebase) for the rebase operation. This isolated the rebase from main worktree state and prevented branch switching.

**Conflict Resolution (3 files, 7 commits rebased):**
1. **.squad/agents/_alumni/mcmanus/charter.md** - Merged both rule sets: DOCS-TEST SYNC (from upstream reskill) and EXTERNAL COMMS, HUMANIZER, AUDIT TRAIL (from PR #427). Used PowerShell regex to extract and combine both sides.
2. **.squad/routing.md** - Accepted Apollo 13 team names (EECOM, PAO, FIDO) from upstream via `git checkout --ours` (in rebase context, "ours" = upstream, "theirs" = our branch). PAO external comms infrastructure is team-agnostic.
3. **.squad/agents/keaton/history.md** - Accepted deletion via `git rm` (file moved to _alumni in upstream recast).

**Rebase Commits:** 7 commits from squad/426-pao-external-comms rebased onto upstream/dev (f87a7a5), covering #423 team reskill, #424 SDK switch, #425/#428 test parity, #429 model updates.

**Force Push:** `git push origin squad/426-pao-external-comms --force-with-lease` succeeded. PR #427 comment posted via gh CLI.

**Pattern:** When working with git worktrees, always create a dedicated worktree for complex operations (rebase, cherry-pick) to avoid main worktree state interference. Use `git worktree list` to diagnose unexpected branch switching.
### SDK Init Flow Deep Dive (2026-03-08)
Traced complete `squad init --sdk` flow end-to-end for unified PRD. Key findings: (1) Init flow has two phases: CLI init creates skeleton files, REPL auto-cast creates team members. (2) Critical gap: squad.config.ts is never updated after auto-cast — members exist in .squad/ but not in config. (3) Ralph is inconsistently created (auto-cast yes, CLI init no). (4) No commands exist for adding/removing members post-init. (5) CastingEngine class exists but is never called during init — LLM-based Init Mode prompt is used instead. Roadmap written to .squad/identity/sdk-init-implementation-roadmap.md with 7 fixes prioritized by dependency graph. Critical path: sync utility → Ralph fixes → CastingEngine integration → hire/remove commands. High-risk items: squad.config.ts AST parsing (considered regex alternative). Open questions: AST vs regex for config sync, CastingEngine augment vs replace LLM, Ralph always-on vs opt-in.

📌 **Team update (2026-03-11T01:25:00Z):** SDK Init decisions finalized: Phase-based quality improvement program, CastingEngine canonical casting, squad.config.ts as source of truth, Ralph always-included, implementation priority order (sync utility first, then Ralph fixes, then CastingEngine integration). All decisions merged to decisions.md. Ready to start Phase 1 implementation.

### Adoption Tracking Tier 1 Implementation (2026-03-10)
Implemented Flight's privacy-first adoption monitoring strategy on PR #326 branch. Moved `.squad/adoption/` → `.github/adoption/` for better GitHub integration. Stripped tracking.md to aggregate-only metrics (removed all individual repo names/URLs). Updated GitHub Action workflow (adoption-report.yml) and monitoring script (scripts/adoption-monitor.mjs) to write reports to `.github/adoption/reports/`. Removed "Built with Squad" showcase link from README.md (deferred to Tier 2 opt-in feature). This honors the principle: collect aggregate metrics via public APIs, but never publish individual repo lists without explicit consent. Test discipline: verified npm run build passes; docs-build.test.ts passed structure tests (Astro build failure unrelated to changes). Committed with clear message explaining privacy rationale.

📌 **Team update (2026-03-10T12-55-49Z):** Adoption tracking Tier 1 complete and merged to decisions.md. Privacy-first architecture confirmed: aggregate metrics only, opt-in for individual repos, public showcase only when 5+ projects opt in. Append-only file governance enforced (no deletions in history.md or decisions.md). Microsoft ampersand style guide adopted for documentation.

### Issue Triage (2026-03-22T06:44:01Z)

**Flight triaged 6 unlabeled issues and filed 1 new issue.**

EECOM assigned:
- **#481 (StorageProvider PRD)** → squad:control + squad:eecom (type system abstraction + runtime integration)
- **#479 (history-shadow race condition)** → squad:eecom + squad:retro (production bug; mitigation through StorageProvider atomicity)

Pattern: Three architectural gaps identified (agent spec, state abstraction, quality tooling) + one production bug. StorageProvider abstraction critical for #479 atomicity fix.

📌 **Team update (2026-03-22T06:44:01Z):** Flight issued comprehensive triage. EECOM owns StorageProvider PRD spec (#481) + history-shadow race mitigation (#479). Ready to begin implementation on next sprint.

### PR #483 Review & Merge — Platform Adapter Timeout Fix (2026-03-22)

Reviewed and merged diberry's fix for platform-adapter test timeouts that were blocking all 8 open PRs. Root cause: `getAvailableWorkItemTypes()` called `execFileSync('az', ...)` with no timeout — in CI where az CLI is installed but no real ADO org exists, it hangs indefinitely until Vitest kills it at 5s.

**Fix pattern:** `{ ...EXEC_OPTS, timeout: 3_000 }` — spread existing exec options and add a 3-second timeout. The existing catch block already returns sensible default work item types, so timeout errors fall through gracefully. This is the correct pattern for any external CLI call that might hang: add a timeout to execFileSync and ensure the catch block has a fallback.

**Rebase note:** Branch was already clean on top of dev (1 commit ahead, no divergence). No rebase was needed.

📌 **Team update:** PR #483 merged (squash). This unblocks CI for all open PRs that were failing on platform-adapter test timeouts. The remaining CI failure across PRs is the broken docs link (separate issue).

### PR #480 Review & Merge — History Race Condition Fix (2026-03-22)

Reviewed and merged PR #480 (async mutex + atomic writes + 14 tests). Addresses race condition in history-shadow file operations under concurrent load.

**Fix pattern:** Race conditions in history operations require three-layer defense: (1) async mutex for write serialization, (2) atomic file operations (write-then-rename), (3) comprehensive test coverage (14 tests for edge cases). This pattern applies to any persistent state under concurrent access.

**Key learning:** File system race conditions aren't just "add a lock" — need atomicity guarantees (rename is atomic), serialization (mutex), and exhaustive test coverage to validate edge cases (concurrent writes, stale reads, partial failures).

### PR #486 Review & Merge — SIGINT Handling (2026-03-22)

Reviewed and merged PR #486 (two-layer signal handling + 22 tests). Improves graceful shutdown under SIGINT (Ctrl+C) by cleaning up both parent and child processes.

**Fix pattern:** Signal handling in Node.js requires two layers: (1) parent process SIGINT handler that triggers graceful shutdown, (2) child process cleanup (kill child processes, close file handles, flush buffers). Incomplete cleanup leaves zombie processes or orphaned file locks. Test coverage essential: 22 tests verify process tree cleanup, signal propagation, and edge cases (nested children, immediate re-signals).

**Key learning:** SIGINT handling is more complex than "add a signal handler" — need explicit child process cleanup logic + comprehensive tests. Pattern applies to any process spawning child processes (CLI spawning subshells, REPL spawning child REPL instances, etc.).
### Economy Mode Implementation (#500) (2026-03-20)

**Context:** Issue #500 requested economy mode — a session-level and persistent modifier that shifts model selection to cheaper alternatives.

**Architecture decision:** Economy mode is a Layer 3/4 modifier only. Layers 0–2 (explicit user preferences: config.json, session directive, charter) are never downgraded. This preserves user intent while enabling cost savings on auto-selected tasks.

**Implementation:**
1. `ECONOMY_MODEL_MAP` + `applyEconomyMode()` in `config/models.ts` — pure mapping function for premium→standard and standard→fast downgrades
2. `readEconomyMode()` + `writeEconomyMode()` — config.json read/write functions (same merge-without-clobber pattern as `writeModelPreference()`)
3. `resolveModel()` in `config/models.ts` updated with `economyMode?: boolean` option; falls back to reading from `squadDir` if not provided
4. `resolveModel()` in `agents/model-selector.ts` updated with `economyMode?: boolean` — both SDK resolvers are economy-aware
5. `squad economy [on|off]` command in CLI for persistent toggle
6. `--economy` global flag in `cli-entry.ts` sets `SQUAD_ECONOMY_MODE=1` env var for session scope
7. 34 new tests in `test/economy-mode.test.ts` — all pass

**Key pattern:** Both resolveModel implementations follow identical principle: explicit overrides (user choice) are sacred; economy only affects computed auto-selection.

**PR:** #500 branch `squad/500-economy-mode`

### node:sqlite Hard-Fail Fix (#502) (2026-03-21)

**Context:** Workshop participants (reported by Doron Ben Elazar) were blocked by `ERR_UNKNOWN_BUILTIN_MODULE` crashes. `node:sqlite` (used by Copilot SDK for session storage) requires Node 22.5.0+. The existing soft-warn-and-continue approach let users limp into a cryptic crash.

**Root cause:** `engines.node` said `>=20` but `node:sqlite` needs `>=22.5.0`. The pre-flight check warned but didn't exit, so users saw confusing failures deep in SDK code.

**Fix:**
1. **cli-entry.ts:** Replaced `try { await import('node:sqlite') } catch { warn }` with a synchronous version check that calls `process.exit(1)` immediately with a clear upgrade message. Removed the now-dead `checkNodeSqlite()` function and its call site.
2. **doctor.ts:** Added `checkNodeVersion()` to `squad doctor` — exported with optional version param for testability.
3. **package.json (×3):** Corrected `engines.node` to `>=22.5.0` so npm/npx warn at install time.
4. **Tests:** 5 new tests for `checkNodeVersion()` (Node 20.x fail, 22.4.x fail, 22.5.0 pass, 24.x pass, current env pass). Updated check-count assertion.

**Pattern:** git branch confusion — `git checkout -b` switches HEAD but edits to files on wrong branch are lost when switching. Always confirm `git branch` before making file edits. File edits don't follow you to a new branch if you forgot to switch first.

**PR:** #506 branch `squad/502-node-sqlite-dependency`

### Rate Limit Recovery UX (#464) (2026-03-22)

**Context:** Rate limit errors showed generic message with no actionable recovery. Brady directive: offer model switching + economy mode as recovery options.

**Implementation:**
1. `error-messages.ts` — `rateLimitGuidance()` shows actual reason + 3 recovery options (retry time, `squad economy on`, config.json model override)
2. `shell/index.ts` — Detects rate limits via `instanceof RateLimitError` or regex; writes `.squad/rate-limit-status.json`
3. `doctor.ts` — `checkRateLimitStatus()` reads status file and warns if recent
4. 36 new tests — all pass

**PR:** #505 `squad/464-rate-limit-ux` — merged (rebased after #504)

### Session 2 Summary (2026-03-22)

Executed 3 tasks across 2 waves: economy mode (#500, PR #504), node:sqlite fix (#502, PR #506), rate limit UX (#464, PR #505). All PRs merged to dev.


### Personal Squad Init via npx (#576) (2026-03-23)

**Context:** `init --global` (used via npx to set up personal squad) created a full `.squad/` structure at `~/.config/squad/` but never created the `personal-squad/` subdirectory. `resolvePersonalSquadDir()` looks for `personal-squad/`, so subsequent repo-level `init` couldn't discover the user's personal agents.

**Root cause:** Two separate concepts - `init --global` scaffolds a full squad, `personal init` creates `personal-squad/`. The `--global` flag never bridged between them.

**Fix:**
1. `resolution.ts` - Added `ensurePersonalSquadDir()` idempotent helper to SDK.
2. `cli-entry.ts` - `init --global` now suppresses workflows and passes `isGlobal` flag.
3. `init.ts` - After global init, calls `ensurePersonalSquadDir()`. After repo init, detects personal squad.
4. `personal.ts` - Refactored to reuse `ensurePersonalSquadDir()`.
5. `resolution.test.ts` - Added 3 tests.

**Pattern:** `resolveGlobalSquadPath()` returns the container; `ensurePersonalSquadDir()` creates the subdirectory the rest of the system looks for.
📌 **Team update (2026-03-25T18:11Z):** Fixed #590 personal squad path regression — getPersonalSquadRoot() now uses canonical personal-squad/ subdirectory like esolvePersonalSquadDir() and nsurePersonalSquadDir(). Committed on squad/590-fix-personal-squad-root. FIDO found same bug in shell/index.ts → work passed to CONTROL for full sweep revision. Awaiting FIDO re-review.

### Rally familiarization (2026-05-15T22:45:19-07:00)

- **Entry points:** `bin/rally.js` is the commander entrypoint. `dashboard` is the primary UX. Repo resolution lives in `lib/dispatch.js`; issue/PR dispatch flows live in `lib/dispatch-issue.js` and `lib/dispatch-pr.js`; shared setup lives in `lib/dispatch-core.js`.
- **Worktree creation:** Rally creates branches with `git worktree add {repo}\.worktrees\rally-{issue}` or `rally-pr-{pr}` via `lib/worktree.js`. Branch names are `rally/{issue}-{slug}` or `rally/pr-{pr}-{slug}`. Existing registered worktrees are reused; stale unregistered worktrees are removed and recreated.
- **PR setup:** PR dispatch creates the worktree first, then runs `gh pr checkout <number> --detach` inside it before writing context. Review context is written to `.squad/dispatch-context.md`; issue dispatch writes analogous issue context there too.
- **Agent launch model:** `lib/copilot.js` spawns detached `gh copilot` sessions, usually with `--agent squad`, `--allow-all-tools`, and a deny list. Rally prepends a read-only dispatch policy and can swap the launcher to `docker sandbox run copilot ...` for sandboxed runs.
- **Parallel dispatch management:** Rally tracks every dispatch in `~/rally/active.yaml`, guarded by a mkdir-based lock plus atomic writes (`lib/active.js`, `lib/config.js`). The Ink dashboard refreshes every 5s; `lib/dispatch-refresh.js` advances `implementing -> reviewing` only after the Copilot PID exits and the log contains Copilot's completion marker (`Total session time:`), then upgrades PID placeholders to real session UUIDs by parsing `.copilot-output.log`.
- **`.squad/` synchronization:** onboarding symlinks the main project checkout to the personal squad for `.squad/`, `.squad-templates/`, and `.github/agents/squad.agent.md` (`lib/onboard.js`). **Dispatched worktrees do not reuse those symlinks.** Instead Rally calls Squad SDK `setupConsultMode()` to copy the personal squad into the worktree-local `.squad/`, writes consult-mode config/agent metadata, patches Scribe for extraction, hides the copied state via `git rev-parse --git-path info/exclude`, and later calls `extractLearnings({ clean: true })` during cleanup to merge generic learnings back home.
- **GitHub transport split:** Rally itself talks to GitHub almost entirely through `gh` / `gh api` (`gh repo clone`, `gh issue/pr view/list`, `gh pr checkout`, trust checks via `gh api user` and org membership). I found no Octokit/API client layer. Once the agent is launched, Rally *denies* `gh` inside the Copilot session and expects GitHub MCP read tools instead.
- **Patterns worth borrowing:**
  - Rally places worktrees under `{repo}\.worktrees\...` instead of sibling directories. That means Node module resolution can naturally walk up to the main repo's `node_modules`, avoiding the explicit `node_modules` junction/symlink step our coordinator prompt still documents.
  - Rally's host/agent split is clean: host process uses `gh` for orchestration, dispatched agent gets local repo access plus MCP reads but no `gh push`/network tools.
  - Rally has concrete dispatch bookkeeping (`active.yaml` + lock + log/PID refresh) that is more operationally complete than our coordinator prompt's mostly procedural worktree lifecycle guidance.

### Fork familiarization — tamirdresher/squad (code layer) (2026-05-15T22:57:50-07:00)

- **High-signal branches:** `feat/state-backend-global-996`, `feat/squad-scheduler`, `feat/upstream-auto-sync`, `feat/cross-squad-orchestration`, `feat/communication-adapter`, and `feat/rework-rate-otel-metric` carry the substantive package-layer deltas. `feat/cross-machine-coordination` is 0 commits ahead; `feat/scheduled-tasks-skill`, `feat/session-recovery`, and `feat/update-model-catalog-588` are template/skill-only; `feat/rework-rate-metric` stays in legacy top-level JS (`index.js`, `lib/rework.js`) instead of `packages/`.
- **`feat/state-backend-global-996`:** expands our existing `packages/squad-sdk/src/state-backend.ts` into a pluggable `StateBackend` layer (`local`, `git-notes`, `external`, `orphan`, `two-layer`). The implementation uses git plumbing plus a `git notes --ref=squad` store anchored to the repo root commit, then wires that into `packages/squad-cli/src/cli/commands/{preset,sync,migrate-backend,install-hooks}.ts`, `packages/squad-sdk/src/presets/*`, and `resolution.ts`. This is not a sidecar experiment — it rewrites/extends modules we already own around squad-home, presets, and state mobility.
- **State persistence pattern:** the branch's most concrete persistence idea is a git-native backend that normalizes keys, serializes JSON payloads into a single note blob, and layers worktree-local state with external/shared state. It also introduces built-in preset assets under `packages/squad-sdk/src/presets/builtin/default/` and a `squad preset init --remote` flow that backs `~/.squad` with a private GitHub repo (`squad-home`) via `gh`.
- **`feat/squad-scheduler`:** adds `packages/squad-sdk/src/runtime/scheduler.ts` plus `packages/squad-cli/src/cli/commands/schedule.ts`. The SDK side defines a provider-agnostic `.squad/schedule.json` schema (cron / interval / event / startup triggers; workflow / script / copilot / webhook tasks), validation, provider interfaces, and run-state tracking; the CLI side adds `squad schedule list|run|init|status` and persists execution state in `.squad/.schedule-state.json`. This lands directly in the runtime/CLI modules we already own, not alongside them.
- **`feat/upstream-auto-sync`:** grows the existing `packages/squad-sdk/src/upstream/` surface with `watcher.ts`, `proposer.ts`, and sync types, then extends `packages/squad-cli/src/cli/commands/upstream.ts` with `watch` and `propose`. The watcher hashes upstream `.squad/` trees, keeps snapshots per upstream, clones git sources under `.squad/_upstream_repos/{name}`, and uses `git pull --ff-only` for polling. This is a direct extension of our upstream module rather than a separate sync subsystem.
- **`feat/cross-squad-orchestration`:** formalizes `.squad/manifest.json` / `.squad/manifest.schema.json` as a discovery contract, then extends `packages/squad-sdk/src/runtime/cross-squad.ts` and `packages/squad-cli/src/cli/commands/cross-squad.ts`. The runtime adds manifest validation, discovery metadata, delegation argument builders, and cross-repo work tracking; the CLI adds `squad discover` and `squad delegate`, with delegation implemented as `gh` issue creation against the target repo. Again: direct edits to our existing cross-squad runtime/CLI modules.
- **`feat/communication-adapter`:** extends the platform layer we already own (`packages/squad-sdk/src/platform/comms*.ts`). `comms.ts` reads `.squad/config.json`, auto-detects GitHub vs Azure DevOps remotes, and chooses a channel adapter (`github-discussions`, `ado-work-items`, `file-log`, placeholder `teams-webhook`). The ADO path shells out to `az boards work-item create/show` and treats a work item discussion/history as the conversation thread; the file-log adapter remains the zero-friction fallback.
- **`feat/rework-rate-otel-metric`:** adds pure PR review/rework calculators in `packages/squad-sdk/src/runtime/rework.ts` and hooks them into `packages/squad-sdk/src/runtime/otel-metrics.ts`. The branch computes rework as commits after first review, counts change-request / approval cycles, and records the result into OTel counters/histograms/gauges alongside the broader token/agent/session metrics surface. No CLI command; this is SDK/telemetry-only.
- **Smaller but still code-bearing branches:** `feat/persistent-ralph` is mostly docs/tests/version churn, but the code change is a direct rewrite of `packages/squad-sdk/src/ralph/index.ts` into a persistent `RalphMonitor` that subscribes to the event bus, tracks agent activity in memory, and persists monitor state to disk for crash recovery. `feat/ado-configurable-items` extends the existing ADO adapter with `getAvailableWorkItemTypes()` via `az boards work-item type list`, making work-item creation process-template-aware. `feat/rename-subsquads` is a terminology refactor over the existing `streams/` implementation, not a separate orchestration model.
- **Dependencies and packaging:** none of the substantive branches add third-party runtime packages. The code stays on Node built-ins plus existing `gh`, `git`, and `az` CLI shells. Package changes are mostly new subpath exports (`./presets`, `./runtime/scheduler`, `./runtime/cross-squad`) and build-copy steps for preset assets, not new npm dependencies.

### Multi-squad storage proposal breadcrumb (2026-05-15T23:06:53-07:00)

Drafted storage strategy in `.squad/decisions/inbox/eecom-multisquad-storage-proposal.md`: Squad should be a manifest-addressed `.squad/` artifact with stable `id`, while storage media are modeled as source adapters feeding existing backends (`local` / `external` / `orphan` / `two-layer`). Recommended machine-local source cache + per-repo stack binding + local overlay, plus a small SDK addition (`SquadStack`, source parsing/materialization, backend capability flags) instead of a new service.

### Multi-squad reuse-vs-new audit breadcrumb (2026-05-16T00:14:13-07:00)

Wrote `.squad/decisions/inbox/eecom-multisquad-reuse-audit.md`. Recommendation: reuse current mainline descendants of `feat/state-backend-global-996` for storage, keep Rally's operator shell (`~/rally/`, `.worktrees/`, consult-mode-based dispatch mechanics) where it already works, and spend net-new effort only on the SDK invariant contract (`resolveSquadStack`, ambiguity/explanation, runtime contract, materialization, reentry). Biggest trap branch for this cycle: `feat/communication-adapter`.


📌 **Team archive (2026-05-17T19:44:23Z):** Multi-squad design phase complete. All Round 1–7 working artifacts archived at .squad/decisions/multisquad-design/ — v1.1 spec is authoritative. See orchestration log for full details.

### Drift / re-entry disposition breadcrumb (2026-05-17T22:41:30-07:00)

Wrote `.squad/decisions/inbox/eecom-drift-reentry-disposition.md`. Recommendation: **downscope** drift/re-entry from an SDK invariant to a thin runtime-contract primitive—an opaque, comparable resolution fingerprint—while moving reopen-time drift detection, re-explanation, and any user-facing reaction into the consuming host or organizational layer. This preserves zero-impact for single-squad users and keeps org policy layered on top of Squad.
