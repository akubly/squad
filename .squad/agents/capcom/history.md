# CAPCOM — History

> Knowledge base for the SDK Expert. Append-only, union-merged across branches.

📌 **Team update (2026-06-05T12:54:00Z — Piece 32 Adversarial Review Complete):** CAPCOM conducted adversarial contract review of piece 32 (registry state fields, commit `f35fa9b5`). Core hypothesis: re-assign preservation mechanism verified SAFE on both warm and cold paths. Verification: (1) `...entry` spread precedes conditional overwrites, existing values survive when options absent; (2) test P32.A5 confirmed as genuine disk round-trip (writeRegistry → loadRegistryFromDisk → validate). Findings: 4 nits (maintenance risk on package.json indentation, spec defect on INVALID_ALIAS error code convention, coverage gap for cold-start re-assign test, doc placement issue on validation JSDoc). No blockers. Verdict: **APPROVE-WITH-NITS**. Decision drop merged to `.squad/decisions.md`.

📌 **Team update (2026-05-19T22:30:35Z — Piece 19 Revision & Ship Complete):** CAPCOM completed two-round adversarial cycle for piece 19 (Copilot payload). Round 1: Identified 3 blocking SDK contract issues (`CopilotPayloadError` surface leak, symlink vulnerability, missing callsign guard). Round 2: Wrapped error surface in both paths, demoted `rewriteFrontmatterName` to internal API, added all 3 FIDO test gaps, verified 143/143 tests pass. Final: single amended commit `2377c3a8`, build CLEAN. ✅ Ship approved. EECOM locked out per Reviewer Rejection Protocol — GNC + CAPCOM (Round 2) owned revision.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils). SDK now exports `normalisedPathKey` + `pathsRefSameLocation` from barrel for general callers. `resolution-v2.ts` re-exports all three path helpers for resolver consumers. Verify downstream SDK-using pieces resolve these imports correctly via barrel or subpath.

## Learnings Archive — Historical Context (summarized)

Previous learnings from pieces 04, 08a, 19, 21, 25, 32 documented: SDK boundary discipline, casting-engine orphaning, resolver parity, registry preservation mechanics, error-code naming conventions, subpath export contracts, config-sync design, path-utils canonicalization, TypeScript build integration. See `.squad/decisions.md` for decisions; `orchestration-log/` for execution traces.

## Recent Learnings

### 2026-06-06: Piece 33 adversarial SDK contract review — sync-from-registry

Performed adversarial SDK contract review of piece 33 (commit `0ce892e2`). All six contract checks passed: imports canonical, entry shape correct, clone matching normalized, helper signatures matched, sessionId generation correct, remote names platform-agnostic. TEAM_ROOT resolution chains correctly (SQUAD_TEAM_ROOT env > registry > config.json). Alias resolution chains correctly (--developer > SQUAD_DEVELOPER_ALIAS > registry developerAlias). Verdict: APPROVE. 

**SDK contract patterns reinforced:** 
- `loadRegistryFromDisk` return destructuring pattern is correct; consumers must destructure `{ registry, warnings }`.
- Env-var overrides (SQUAD_TEAM_ROOT) bypass registry entirely; callers must supply explicit options or accept defaults.
- Registry path uniqueness enforced at load time; `registry.squads.find()` returns first (and only) matching entry.

### 2026-03-14: WSL Transient API Error Investigation (Issue #363)

**Context:** User reported "Request failed due to a transient API error" on Ubuntu WSL with Copilot CLI v1.0.4, eventually hitting rate limits.

**Investigation findings:**
- Squad SDK already implements robust retry logic with exponential backoff (1s → 2s → 4s)
- Retry logic in `adapter/client.ts:820-880` handles transient connection errors (ECONNREFUSED, ECONNRESET, EPIPE)
- Rate limit detection in `adapter/errors.ts:229-245` with retry-after awareness
- Error originates **upstream** from Copilot CLI/API platform, not Squad
- Copilot CLI v1.0.4 internal retry behavior triggers the rate limiting before Squad is invoked
- Squad only interacts with CLI via `@github/copilot-sdk` adapter after CLI is already running

**Key insight:** Squad SDK does NOT contribute to transient API errors or rate limiting issues. Our retry logic follows platform patterns and only applies to SDK connection errors, not upstream API instability.

**Outcome:**
- Confirmed this is an upstream platform issue (not a Squad bug)
- Recommended user check network connectivity, WSL configuration, and GitHub auth
- Created decision in `.squad/decisions/inbox/capcom-wsl-transient.md`
- Suggested documentation improvement: add WSL troubleshooting guide

**Pattern learned:** When investigating API errors, distinguish between:
1. **SDK adapter layer** (our retry logic) — handles connection errors only
2. **Copilot CLI layer** (upstream) — handles API communication and its own retries
3. **Copilot API platform** (upstream) — source of transient errors and rate limits

Squad operates at layer #1, so issues at layers #2-3 are outside our control.

### 2026-06-05: Piece 32.5 — State Transport Helpers Adversarial Review

**Context:** EECOM implemented `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` in `packages/squad-cli/src/cli/commands/sync.ts` (uncommitted working-tree changes on `squad/piece-32.5-state-transport-helpers`).

**Findings (all checks against CONTRACT FACTS for piece 33):**

1. **Signatures** — Exact byte-for-byte match. Parameter names, types, order, `export async function` keyword all correct.
2. **DEVELOPER_ALIAS_RE import** — `import { DEVELOPER_ALIAS_RE } from '@bradygaster/squad-sdk/validation'`. Identical source to `assign.ts`. The `./validation` subpath export is present in `packages/squad-sdk/package.json`. Regex value `/^[a-z][a-z0-9-]{1,38}$/` matches canonical. ✅
3. **No forbidden internal resolution** — Neither helper body calls `detectBackend`, reads `config.json`, queries the registry, or resolves env-vars for input. All parameters received from caller. ✅
4. **teamRoot semantics** — `enumerateSquadFiles` builds `path.join(teamRoot, '.squad')` as the base dir. Index file at `path.join(teamRoot, '.git', ...)`. Hydrate git-dir at `path.join(teamRoot, '.git')`. All file writes via `path.join(teamRoot, filePath)`. Correct parent-dir treatment throughout. ✅
5. **Build** — Build fails, but baseline (committed state) already had identical TypeScript errors in `assign.ts`, `doctor.ts`, `init.ts`, `unassign.ts`. No new errors introduced by `sync.ts`. ✅ (pre-existing debt)
6. **Export vs invoke** — Both helpers are `export async function`. Neither is called from `runSync`. ✅

**Advisory (non-blocking):** `publishTeamRootToInbox` throws (rather than silently skips) on any `.squad/` file outside the allowlist. On a live squad repo with `team.md`, `agents/`, `plans/` under `.squad/`, the first call will throw. Strict-guard design — confirm or switch to filter semantics before piece 33 integration.

**Verdict: APPROVE**

## Core Context

- **Project:** Squad — AI agent orchestration framework
- **Role:** SDK Expert
- **Joined:** 2025-01-25

## Learnings

### 2025-01-25: SDK Init Implementation Deep Dive

Completed deep technical analysis of `squad init --sdk` code paths. Key findings:

**CastingEngine is orphaned** — The SDK has a full universe-based casting system (`packages/squad-sdk/src/casting/casting-engine.ts`) with themed characters (The Usual Suspects, Ocean's Eleven), personality traits, backstories, and role-matching algorithms. **But no code calls it.** The CLI bypasses it with a hardcoded `personalityForRole()` function that generates generic personalities based on role patterns.

**Config/team sync is one-way** — The REPL init flow generates team.md, routing.md, and registry.json when casting a team, but never updates squad.config.ts. Meanwhile, `squad init --sdk` generates squad.config.ts with only Scribe, missing Ralph and all other agents. The disconnect: CLI init writes a skeleton + prompt, REPL auto-cast generates the team, but the two paths never merge into a unified config.

**Built-in agents are inconsistent** — Ralph is added by the REPL casting flow (`cli/core/cast.ts:385-386`) but not by SDK init (`cli/core/init.ts:109-115`). @copilot is a pseudo-agent — a Markdown table row inserted via `team-md.ts:insertCopilotSection()`, not a real agent with charter/history files.

**Universe selection is a dead end** — The coordinator init prompt asks the LLM to pick a universe (line 52: "Pick a fictional universe for character names"), and the coordinator responds with `UNIVERSE: Alien`, which gets stored in `casting/history.json`... and then **nothing uses it**. There's no mapping from freeform universe names to CastingEngine templates.

**The fix path is clear** — Three priority levels:
- **P0 (trivial):** Add Ralph to SDK init agents array, guide coordinator to existing CastingEngine universes
- **P1 (small/medium):** Integrate CastingEngine into CLI casting, make REPL init write squad.config.ts
- **P2 (design-heavy):** Decide config sync strategy (config-as-source vs. bidirectional), decide if @copilot should be a real agent

Written full technical analysis to `.squad/identity/sdk-init-technical-analysis.md` with file/line references, complexity estimates, and actionable recommendations for Brady's PRD.

**SDK patterns observed:**
- `defineSquad()` / `defineAgent()` builder pattern is clean and works well
- `configFormat` enum supports 'sdk' | 'typescript' | 'json' | 'markdown' — flexible but undertested
- Init flow is two-phase (CLI writes skeleton, REPL auto-casts) — intentional design but creates sync issues
- Template system in SDK (`templates/` directory) is well-structured, used correctly by `initSquad()`

📌 **Team update (2026-03-11T01:25:00Z):** 5 SDK Init decisions merged to decisions.md: Phase-based quality improvement (3-phase approach), CastingEngine canonical casting, squad.config.ts as source of truth, Ralph always-included, implementation priority order. Full technical analysis informed Flight's unified PRD and EECOM's roadmap.

📌 **Team update (2026-03-25T18:11Z):** CLI platform research complete — identified Copilot CLI 1.0.5–1.0.11 (8 releases in 10 days) contain three high-impact changes affecting Squad routing: monorepo instruction discovery (1.0.11), idle subagent hiding (1.0.8), subagentStart hook context injection (1.0.7). SDK version pinning doesn't prevent CLI runtime auto-updates. Recommendations: clean up template naming, upgrade to SDK 0.2.0 customize mode, file CLI issue. Report in decisions inbox.

📌 **Team update (2026-05-13T18:28:28Z — Piece 04 Adversarial Review Complete):** Piece 04 (path-utils-upsert-rename) approved after revision cycle. Deferred architectural findings for piece 05+: spurious @bradygaster/squad-cli changeset bump, normalisedPathKey re-export scope creep on resolution-v2.ts (registry primitive on resolver surface), wrapper-style registerEntry alias drift risk, @deprecated tag missing removal timeline. See `.squad/decisions.md` "### 2026-05-13: CAPCOM Review" for full action items. Future pieces that re-export SDK primitives should apply same scope discipline.

### 2026-05-14T14:38:40.349-07:00: Piece 08a revision — SDK boundary and resolver parity

Revised the read-only resolver migration under reviewer rejection lockout as CAPCOM. The revision kept SDK access through the root barrel by adding an overload-compatible registry-aware `resolveSquad` wrapper in `packages/squad-sdk/src/index.ts`, then rerouted `packages/squad-cli/src/cli-entry.ts`, `packages/squad-cli/src/cli/commands/config.ts`, and `packages/squad-cli/src/cli/commands/cross-squad.ts` away from SDK subpaths.

The revision unified `discover` and `delegate` on v2 resolution, threaded `--team-root` / `SQUAD_TEAM_ROOT` into cross-squad discovery, and strengthened `test/cli/legacy-resolver-migration.test.ts` to cover SDK barrel import, override parity, delegate resolution, and the action-command boundary. `.changeset/migrate-readonly-commands.md` now records both CLI and SDK patch impact.

**Revision complete:** Commit 0e4f301e. Logged to `.squad/orchestration-log/2026-05-14T21-38-40Z-capcom.md`. Full suite 6,308/6,432 PASS; build clean; scrub gates 2/4/5/6 PASS. CONTROL locked out for further 08a revisions unless re-rejection cycle restarts.

### 2026-05-21: Canonical callsign validation convergence

When the same validation rule spans SDK reader paths, payload namespace code, and CLI maintenance commands, extract a shared helper in the SDK and make downstream packages import it through the barrel instead of copying regexes inline.

The specific smell to watch for is writer/reader/doctor triple-divergence: once those three paths disagree, users get inconsistent acceptance rules and tests stop guarding the real contract.


---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

### 2026-06-05: Piece 32 adversarial contract review — registry state fields

Performed peer-adversarial SDK contract review of piece 32 (stateRemote/stateBranch/developerAlias on RegistryEntry; `--state-remote`/`--state-branch`/`--developer-alias` on `squad assign`; `DEVELOPER_ALIAS_RE` extracted to `packages/squad-sdk/src/validation.ts` with `./validation` subpath export).

**Key findings:**

- **Re-assign preservation (H1): CORRECT.** Both `_warmPath` and `_coldStart` spread the existing entry first (`...entry` / `...baseEntry`) before applying conditional state-field overrides. Preservation test P32.A5 is a genuine disk round-trip, not a mock-only test.

- **package.json export map (H2): VALID, COSMETICALLY BROKEN.** JSON is structurally valid (node-confirmed). `./validation` is correctly placed as a sibling export. `dist/validation.js` and `.d.ts` exist. However, brace indentation around lines 240–245 is shifted relative to every other export entry — visually implies nesting that does not exist.

- **Error code convention (H4): SPEC MANDATES INCONSISTENCY.** `INVALID_ALIAS` breaks the `ERR_ASSIGN_*` prefix pattern shared by all other assign error codes. Spec errata should rename to `ERR_ASSIGN_INVALID_ALIAS` before any piece-33/34/35 consumer hard-codes the bare name.

- **Coverage gap:** Cold-start re-assign preservation has no test. Code is correct; scenario is missing (reactivating cold-start with existing stateRemote → re-assign without flag → assert preservation).

- **Doc concern:** `validation.ts` JSDoc mentions `'origin'`/`'squad-state'` defaults that belong to piece-33 consumer semantics, not the SDK validation module.

**Verdict:** ⚠️ APPROVE-WITH-NITS. Decision drop at `.squad/decisions/inbox/capcom-piece-32-adversarial.md`.

**SDK contract patterns reinforced:**
- Subpath export contract = `package.json` export map entry + tsconfig coverage + dist file existence. All three must be verified independently.
- Additive merge on registry entries requires `...existingEntry` spread as the FIRST element of the new-entry object literal. Order matters — later spreads silently override earlier ones.
- Error code naming in a typed union (`AssignErrorCode`) creates a forward-compat surface. Convention breaks in the union propagate to every downstream switch statement. Name before first consumer.
