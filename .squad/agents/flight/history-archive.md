# Flight — Archive (Pre-Piece 05)

> Learnings from wave 1 pilots, crash recovery, release crisis, triage sessions, etc.

---

## Core Context

Three-branch model (main/dev/insiders). Apollo 13 team, 3931 tests. Boundary review heuristic: "Squad Ships It" — if Squad doesn't ship the code, it's IRL content. Proposal-first: meaningful changes need docs/proposals/ before code. Two-error lockout policy: agent locked out after 2 errors in a session. Test name-agnosticism: framework tests must never depend on dev team's agent names.

## Learnings

### Branch-relevant fix plan — Piece 21 (2026-05-22)

📌 **9 fixes scoped and sequenced for piece 21 execution.**

After full attribution pass, 9 fixes are in scope (LOCAL + bucket-b pre-existing that block shared-squad functionality). Two gaps dropped after no-shipped-users analysis: T2-2 (multi-format registry migration) and T3-6 (backward-compat mode) — registry feature is entirely new on this branch, no legacy consumers exist. T2-5 and T3-5 are confirmed duplicates; merged into single FIX-7.

**6 ship-gate fixes (must land before piece 21 merges to dev):**
FIX-1 (SDK smoke-test in upgrade), FIX-2 (upgrade copilot payload repair), FIX-3 (doctor .gitattributes/.gitignore), FIX-4 (registry schema migration), FIX-5 (per-entry corruption detection), FIX-9 (skills/instructions/global-agent doctor checks).

**3 follow-on fixes (post-merge to dev):**
FIX-6 (bulk stale-path repair via --normalize), FIX-7 (cross-platform path display), FIX-8 (dual-doctor structural unification — deliberately deferred to piece 22 to avoid L-complexity landing in piece 21's blast radius).

**Architectural ruling on dual-doctor:** Do NOT unify in piece 21. Add new checks to legacy doctor now (the "wrong" form), then unify in a dedicated piece-22 PR. Unification is L complexity and doesn't unblock any piece-21 functionality. The compounding benefit is real but the coupling risk in piece 21's PR is not worth it.

**Wave plan:** Wave 1 (FIX-4, FIX-5 — data contract), Wave 2 (FIX-1, FIX-2, FIX-3, FIX-9 — core functionality, parallelizable), Wave 3 (FIX-6, FIX-7, FIX-8 — polish, FIX-8 deferred).

### Piece 19 Adversarial Review — APPROVED (2026-05-19T22:30:35Z)

📌 **Spec parity confirmed.** 19/19 spec tests present in `assign-payload.test.ts`. Guard ordering (cold-start load → callsign validation → registry write) correct per spec. Error surface properly wrapped post-CAPCOM revision. Symlink safety + callsign format validation (post-GNC revision) complete. All gates pass. ✅ Ship-ready.

### Piece 14 Adversarial Review — APPROVED WITH FINDINGS (2026-05-18)

📌 **Guard-ordering tests must use mocks that simulate the NEXT guard's normalization behavior, not identity mocks.**

Adversarial review of `squad assign` (warm path + cold-start) found no code bugs but identified a significant test gap: the containment guard ordering test (A15) uses `getGitRoot: (dir) => dir`, which doesn't prove the ordering prevents false idempotency. Real git root resolution collapses subdirectories to their repository root. A test needs `getGitRoot: () => parentCloneRoot` to demonstrate that Guard 4 fires BEFORE Guard 5 prevents the collapse from reaching Guard 6.

**Additional findings:** 6 minor (multi-clone growth untested, origins within-batch dedup gap, inactive reactivation assertion incomplete, no negative filesystem assertion on warm path, forward-compat only tested on target entry, cold-start orphan on registry-write failure). 2 nits (branch fallback unimplemented per "may" provision, relative `--clone-to` path resolution untested).

**Pattern confirmed:** Ordered-guard test discipline requires mocking the DOWNSTREAM guard's transformation function to its realistic output, then proving the UPSTREAM guard catches the scenario first. Identity mocks prove the guard fires but leave ordering bugs invisible.

### Piece 13 Adversarial Review — REJECT → Fixed → APPROVE (2026-05-18)

📌 **PowerShell backtick corruption in commit messages caught by byte-level verification. Static spec-parity checks alone would have missed this.**

Review of hard-remove-register feature identified a critical commit-message corruption: PowerShell's backtick escape processing in double-quoted heredocs consumed backticks and following characters before git received the message. The message text shipped corrupted (`` `register` `` → `register` missing backtick). This manifests only at commit-write time — no code diff visibility, no spec-parity check would catch it.

**Key insight:** Adversarial reviewers must verify commit message bytes directly, not just tree content. The static spec-diff analysis was clean; the blockeroccurred purely in metadata. Surgeon applied a targeted message-only amend under reviewer-lockout, force-pushing with tree preservation and trailer intact.

**Non-blocking findings:**
- HIGH: Baseline contamination (lingering `register` references in test fixture data); accepted as upstream cleanup.
- MEDIUM: Test rigor gap (static spec-parity vs. behavioral removal lifecycle verification).
- LOW: Missing `squad register --help` refusal test.

**Decision recorded:** New PowerShell-backtick safety decision captured in `.squad/decisions/inbox/surgeon-commit-msg-backtick-safety.md`; new skill `.squad/skills/commit-message-quoting/SKILL.md` published team-wide.

### Piece 10 Review — APPROVE (2026-05-15)

📌 **Init fail-fast approved. Solid validation-before-write pattern with one forward-looking concern.**

The three-guard ordering (scaffold → callsign → clone-path → scaffold write → registry write) is correctly enforced in code structure, not just convention. Each guard throws before any filesystem mutation. Exit code 2 scoping is safe today (catch block is init-specific) but the mechanism (`instanceof ConfigurationError`) could overload if future commands adopt the same pattern without introducing a more specific error subclass. Noted as non-blocking architectural concern.

**Key findings:**
- No critical blockers.
- Reactivation path creates scaffold dirs without writing registry — acceptable since sentinel check already passed and inactive-entry handling is deferred to later pieces.
- Clone-path guard correctly delegates to `clonesMatch` with separator-bounded containment (sibling prefix non-match verified).
- Tests are behavioral (command-level contracts), not implementation-coupled. A legitimate refactor of internal variable names would not break them.
- Exit code 2 contract is init-only today. Future expansion should introduce a `ConflictError` subclass rather than overloading the `ConfigurationError` instanceof check.

**Phase C decision recorded:** Exit code 2 means "conflict user can resolve by choosing different target/callsign/directory." Future commands should subclass ConfigurationError rather than reusing raw instanceof check. Applies to all CLI error-to-exit-code mapping patterns.

### Piece 08c Review — APPROVE (2026-05-14)

📌 **VOX lifecycle command migration approved without blockers.**

VOX's 08c implementation correctly threads `resolvedForStart.path` / `resolvedForRc.path` as `squadDir: string` into runners, defers dynamic imports until after the guard, and separates process CWD from squad metadata path. Two minor findings deferred: (1) resolver throws propagate to top-level handler instead of local `fatal()` — consistent with 08b but produces raw stack trace on non-SquadError; (2) no `start throws` dispatch test (only null test exists, throw test exists only for rc). Neither blocks Phase C.

**Pattern confirmed:** For runners that only need the resolved path (not callsign or registry metadata), threading `squadDir: string` is acceptable. Full-struct threading (`resolved: guardResult`) reserved for runners needing richer resolver context (e.g., assign).

### Piece 08b Revision — Sims Folded Flight Nits (2026-05-14)

📌 **Flight nits folded into Sims revision as non-blocking tech debt.**

Flight's APPROVE WITH NITS identified dual resolver imports and inconsistent guard placement across consult/link/assign commands. These were architectural nits (non-blocking for 08b), but valuable for follow-up cleanup.

**Sims resolution:**
- **Dual imports:** Harmonized to single import source. `resolveSquadV2` alias in `cli-entry.ts` for namespace collision avoidance; direct import `resolveSquad` in `assign.ts` fallback for programmatic callers. Clear pattern documented.
- **Guard placement:** All three commands now use dispatch-level guards in `cli-entry.ts` as primary protection. `assign.ts` retains internal fallback guard (`opts.resolved ?? resolveSquad(...)`) for non-CLI direct API use. Consistent: dispatch is the authority for CLI invocations; internal resolution is safety net for programmatic callers.

**Pattern established:** Dispatch guards are the primary CLI protection layer. Module-internal guards are fallbacks for non-CLI code paths. Future pieces (08c+) should follow this pattern.

### Piece 06 Adversarial Review — Dispatch Coverage (2026-05-14)

Source-sniff tests can mask CLI dispatch coverage gaps; require behavioral assertions for flag handling and real child-process spawning to catch entry-point arg parsing errors.

### Resolver piece reviews require chain-precedence coverage (2026-05-13)

Piece 03 introduces five new resolver chain steps (clones, origins, platform, worktree, init-guard). Pairwise precedence tests are acceptable when the resolver is sequential (no branching between steps). A single 8-step test would be ideal documentation but is not a blocking requirement. Future resolver pieces that introduce conditional branching between steps MUST include a single comprehensive chain test.

### Resolver test coverage pattern for platform-specific behavior (2026-05-13)

When a path-comparison function uses `process.platform` directly (no platform parameter injection), tests for platform-specific branches can only run on the matching host. Any test that cannot fully execute on the current platform must do one of:
1. **Conditional real assertion**: `if (process.platform === 'win32') expect(result).toBe(true)` — not `expect(typeof result).toBe('boolean')`.
2. **Skip clearly**: `if (process.platform !== 'linux') return;` with a comment explaining why.
3. **Inject platform**: Refactor the function to accept `platform?: NodeJS.Platform` so tests can override it.

Placeholder assertions that pass trivially are worse than no test — they give false confidence.

### Piece 21 Audit: upgrade + doctor Coverage vs Pieces 1–21 (2026-05-21)

📌 **Upgrade and doctor are the correct surfaces for repair/diagnosis.** Init's idempotency guard (short-circuit on existing scaffold) makes it the wrong place for repair logic. Upgrade owns "bring repo to latest template state." Doctor owns "diagnose drift from expected state." This scoping is confirmed by the audit — every gap maps cleanly to one or both.

**Key architectural gaps found:**
1. `upgrade` (core) handles `.github/agents/squad.agent.md` and global `~/.copilot/agents/squad.agent.md` but does NOT verify per-repo copilot payload state (piece 19). Doctor's registry-aware module diagnoses orphan payloads but upgrade has no path to repair them.
2. Doctor has TWO independent implementations: legacy `cli/commands/doctor.ts` (checks local repo health) and registry-aware `commands/doctor.ts` (validates registry state). They are called sequentially from `cli-entry.ts` but share no result model, no common severity enum, and no common `--fix` surface. This architectural split creates the asymmetries found across pieces 5–21.
3. `upgrade` does not validate SDK symbol resolution (`defaultRegistryFilePath`) after template refresh — the smoke test failure that precipitated this audit.
4. Pieces 12 (platform adapter), 13 (hard-remove-register), 17 (fuzzy-match), are pure library additions with no upgrade/doctor surface implications.

**Upgrade-vs-init scoping principle (CONFIRMED):**
- `init` = first-time scaffold creation + registry registration. Guards: fail-fast on conflicts. Must not attempt repair.
- `upgrade` = evolve an existing squad to latest version. Writes templates, runs migrations, syncs skills, refreshes agent files. May overwrite.
- `doctor` = diagnose without mutating (except `--purge`/`--normalize`). Reports actionable findings for manual or upgrade-driven repair.

### Branch Attribution Pass — Piece 21 Gaps vs origin/dev (2026-05-21)

📌 **The vast majority of T1/T2 gaps are LOCAL — introduced by this branch's new features (pieces 14–21).**

Branch `akubly/upstream-21-post-stack-review` is ~30+ commits ahead of `origin/dev`. Origin/dev has NONE of: `registry.ts`, `copilot-payload.ts`, `resolution-v2.ts`, `path-utils.ts`, `callsign.ts`, `platform/adapter-factory.ts`, `commands/doctor.ts`, `commands/init.ts`. The entire registry-aware command layer is local.

**Attribution summary:** 5 T1 gaps → 1 origin/dev + 4 local. 6 T2 gaps → 1 origin/dev + 4 local + 1 unclear. 8 T3 gaps → 6 origin/dev + 2 local. All 5 cross-command asymmetries are origin/dev. Dual-doctor structural gap is local.

**Key re-classification:** T1-3 (global agent refresh in upgrade) was a local gap and is now PARTIALLY FIXED by commit `6a29bfa7` — `installCoordinatorAgent(requireExisting: true)` added to both upgrade paths.

**Ship implication:** Local T1/T2 gaps (registry schema migration, per-repo payload repair) are the real blockers for piece 21 quality. Origin/dev T3 polish gaps (dry-run, instrumentation, diagnostics) are long-standing debt that can defer.

---

## Pieces 22–24 Wave (2026-05-22 to 2026-05-27)

Archived from main history.md as part of summarization gate (≥15360 bytes). See history.md for current piece 25 scope decision.

### Piece 22 — Dual-Doctor Unification (2026-05-22)

**Branch:** `squad/piece-22-unify-doctors` | **LOC:** 165 diff lines. Net production delta: ~87 LOC.

**Key decisions:**
- Architecture: `runUnifiedDoctor` lives in `cli/commands/doctor.ts` to keep import surface minimal.
- Exit-code: `error → 2` (per piece 14 convention: "operation blocked by state").
- Test seam: `copilotHome` option inherited from registry doctor opts.
- Registry finding severity: batch severity (global `RunDoctorResult.severity`) applied uniformly.

**Spec contradictions:** None. Test migration guidance was accurate; kept `runDoctor` as deprecated export.

**Adversarial review findings (REJECTED initially, then CONTROL revised):**
- Blocker 1: warn→stderr routing fixed in `renderFinding()`
- Blocker 2: Cross-source escalation test added
- Pattern learned: Warn-to-stderr contracts require verifying BOTH exit code AND stream routing.

**Revision approved:** Commit 78297559. All gates green: build CLEAN, lint CLEAN, 53/53 doctor tests.

### Piece 23 — Shared CLI Conventions (2026-05-23)

**Branch:** `squad/piece-23-shared-cli-conventions` | **Commit:** `fced6e99` | **Net LOC:** ~17 production.

**Items selected:** D-3 (emoji-string heuristic), D-5 (resolveSquadDir duplication), D-11 (qrcode types), D-13 (seam convention documentation).

**Learnings:**
- Economy.ts divergence: Manual 10-level walk vs. SDK resolver (both semantically correct; SDK is better for git worktrees).
- Spec vs. code: `checkGlobalAgent` vs. actual `checkCopilotInstructions` — always locate by grep, not by spec-stated function names.
- Stacking on piece 22 was clean — piece 23's doctor.ts change was orthogonal to piece 22's renderer changes.

**Tension:** Piece 23 stacked on piece-22 pending Brady's local review. Pre-existing test failures (15 total) confirmed by stash/test/restore.

### Piece 24 — SDK Adapter and OTel Typing Hardening (2026-05-27)

**Branch:** `squad/piece-24-sdk-adapter-otel-typing` | **Commit:** `b1a710fd` | **Net LOC:** ~114 (target ~59, ceiling 200 ✅).

**Gates:** tsc CLEAN · build CLEAN · lint CLEAN · 88/88 tests PASS

**Items selected:** D-6, D-8, D-9, D-16 (pure typing/naming cleanup). **Deferred:** D-14 (span propagation, prerequisite unmet).

**CONTROL finding:** Variadic `startActiveSpan` was both unnecessary AND weaker than 3 concrete overloads.
- The eslint rule being suppressed (`@typescript-eslint/no-explicit-any`) was NOT in the project's ESLint config.
- Real OTel interface is 3 concrete overloads, not variadic. Matching it exactly preserves `ReturnType<F>` inference.
- Lesson: Check actual interface before approximating. Verify lint rules are in config before granting suppression concessions.

**Variance from LOC estimate:**
- `OTelDiagLoggerLike` interface (+6 LOC): `DiagConsoleLogger` implements only `DiagLogger`, not `DiagAPI`.
- `NoopDiagLogger` (+5 LOC): 5-method interface requires 5-method implementation.
- `_noopStartActiveSpan` in `otel-api.ts` (not `otel-types.ts`) to avoid circular dependency.

**Return type strategy:** `getTracer()`/`getMeter()` return types inferred (not explicit), letting TypeScript unify structurally compatible shapes.

**Chain handoff:** Written to `~/.copilot/session-state/41b7998d.../files/stack-chain-piece-21-thru-24-handoff.md`

### Key Heuristic: Feature vs. Cleanup Split Within Audit Clusters

Audit-suggested groupings are not always coherent in work type. D-14 (span propagation, feature work with conditional "when complete" prerequisite) was grouped with typing debt (D-6, D-8, D-9, D-16) but should be split before authoring the spec. Updated `ship-debt-selection/SKILL.md` with this heuristic.

---

## Archive

See earlier entries in this file for learnings prior to piece 21 (2026-05-13: crash recovery, triage sessions, release crisis, Wave 1 personal squad, adoption tracking, issue triage patterns, PR review pipeline, personal squad architecture, community PR batches, etc.).
