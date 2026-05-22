# FIDO

> Flight Dynamics Officer

## Core Context

Quality gate authority for all PRs. Test assertion arrays (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS, etc.) MUST stay in sync with files on disk. When reviewing PRs with CI failures, always check if dev branch has the same failures — don't block PRs for pre-existing issues. 3,931 tests passing, 149 test files, ~89s runtime.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). All 137 targeted tests GREEN. 11 new tests added per spec. No test assertion changes. Scrub gate 1 (legacy coverage) pre-existing baseline carryover approved by Brady; gates 2–6 pass. Decision merged to decisions.md: path-utils canonical home policy. Branch ready for Phase C (PR review). Next session: piece 05.

## Learnings

### Piece 19 Quality Review — Copilot Payload (2026-05-19T22:30:35Z)

**Verdict:** REJECT (Round 1) → APPROVED (Round 2)

**Round 1 Blocking Gaps:**
1. **Cold-start payload ordering:** No test coverage for multi-payload load sequence. Does `loadPayloads([p1, p2, ...])` preserve registration order in frontmatter?
2. **Hyphenated callsign extraction:** `_extractCandidateCallsign` not tested against `callsign-with-hyphens`. Does it extract correctly?
3. **`runDoctor` integration:** `runDoctor` not exercised as part of payload assignment flow. End-to-end wiring uncovered.

**Round 2 Resolution (CAPCOM):**
- Added test for cold-start ordering validation (multi-payload sequence)
- Added test for `_extractCandidateCallsign` with hyphens
- Added integration test for `runDoctor` → payload assignment wiring

**Final verdict:** ✅ APPROVED. 143/143 tests GREEN (96 spec + 26 security + 3 coverage + 18 integration). Build CLEAN.

### Piece 14 Quality Review — squad assign (2026-05-18T12:19:14Z)

**Verdict:** APPROVED

**Build:** CLEAN. **Tests:** 21/21 GREEN. All 21 spec scenarios covered (A1–A21). Each test asserts structured behavior: registry state on disk, `result.kind`, error code/text. No test is a bare exit-code check.

**Commit hygiene:** 7 files only (`.changeset`, `packages/squad-cli/package.json`, `cli-entry.ts`, `assign.ts`, `assign.test.ts`, `registry.ts`, `vitest.config.ts`). No `.squad/` state files in the code commit. PASS.

**Scrub gate:** Gate 1 (strip-listed paths) and Gate 2 (wifi-aware mention in `.squad/reviews/piece-13-adversarial-review.md`) FAIL — both confirmed pre-existing at HEAD~1. No new strip-listed paths or wifi-aware content introduced by piece 14 diff. Not attributable to piece 14.

**Two non-blocking observations recorded for future replay improvement:**

1. **Containment guard ordering test gap (A15).** The test uses `getGitRoot: (dir) => dir` (returns subdir as-is). This proves the containment guard fires for a subdir, but does NOT demonstrate the most dangerous ordering failure: if `getGitRoot` were called first and returned the parent clone root (as real git would), Guard 6 idempotency would match the clone root and return a spurious `alreadyAssigned`. A companion variant using `getGitRoot: () => cloneDir` would prove the guard runs before git-root resolution and prevents that false positive. For future pieces with ordered guards, the test for guard N ordering should use a mock that simulates what guard N+1 would incorrectly normalize.

2. **A5 (inactive reactivation) doesn't assert `clones[]` update.** A5 only verifies `status` flips to `active`. Clone binding on reactivation is cross-covered by A1 but not asserted in A5. Suggest asserting both `status === 'active'` AND `clones` contains the new path in the same test for completeness.

**Pattern learned — Injectable-seam guard-order tests:** Ordered guards where guard N uses raw `cwd` and guard N+1 normalizes via git/FS require the guard N test mock to simulate the normalized output guard N+1 would produce. Using identity mocks proves the guard fires but leaves ordering question unanswered when normalization changes the path.

### Piece 10 Adversarial Test Review — init fail-fast (2026-05-15T23:15:56Z)

📌 **Team update — Piece 10 Revision Complete:** Piece 10 init fail-fast received split verdict (Flight APPROVE-3-notes, FIDO REJECT-6-gaps, RETRO APPROVE-WITH-FIXES). Per strict lockout protocol, EECOM locked out for this cycle. CONTROL + Sims assigned joint revision and delivered fix: CONTROL unified init validation routing and added lstat-based symlink sentinel; Sims addressed all 6 FIDO test gaps. Guard-order E2E proven via dispatch path with derived callsign conflict; clone-collision tests added for default+explicit registry scenarios; `.squad` symlink collision proven with lstat rejection; registry byte stability: snapshots after all conflict paths; typed error assertions for `SquadError` and `ConfigurationError` instances; test label/assertion alignment corrected. Scaffold-file assertions (no dir/file creation on conflict), CLI stderr contract assertions (specific conflict identification), exit code 2 verification all added. Surgeon squashed revision into `331894e8`. Build CLEAN. 28/28 tests GREEN. Pattern learned: For fail-fast guards, every negative test must assert three things in the same scenario—exact error contract, no filesystem mutation, and registry byte-for-byte unchanged. Separate tests for each axis leave order and side-effect regressions invisible.

### Piece 08c Adversarial Review — GNC Revision (2026-05-15T00:54:18Z)

**Verdict:** APPROVE_WITH_FOLLOWUPS

All 6 spec-mandated tests exist and pass GREEN (23/23, 21.9s). Resolver integration is structurally sound — `resolveSquadV2` runs before long-lived state for both `start` and `rc`. Mock seams prevent real tunnels/spawns. `SQUAD_CALLSIGN` destructure-omit pattern correctly applied in new `runCliShort` helper.

Two majors found (not blocking):
1. `rc does not start bridge when resolution throws` only asserts `timedOut === false` — does not verify error message surfaced. Weak gate.
2. `start preserves Copilot passthrough args` exercises runner layer via vi.doMock, not the dispatch-layer's copilotArgs filter. A bug in cli-entry's squadFlags array would pass this test.

Minors: no symmetric `start` resolver-throw test; no deprecation-notice regression gate; 150ms fixed timeouts in mock assertions (flake risk under load). Snapshot drift is pre-existing CRLF noise only.

Pattern learned: Dispatch-level tests that use vi.doMock + direct import of the runner module do NOT exercise the dispatch glue code. Always verify which layer the test actually hits vs. which describe block it lives in.

### Piece 08a Delta Triage — Failure-Set Diff (2026-05-14T14:38:40.349-07:00)

Compared full-suite Vitest JSON failure sets from `fcb0cf1a` and `0e4f301e` by exact `{file} :: {test name}` IDs, then reran each newly failing revision test individually 3×. Clean rerun observed 3 new failed-test IDs and 2 fixed IDs; all 3 new IDs passed individually 3/3, so the delta is flake/noise rather than a deterministic SDK barrel export regression. This failure-set comparison is the right tool for revision delta triage because aggregate pass/fail counts hide churn between fixed baseline failures and newly exposed flakes.

### Piece 06 Quality Gate — Regex + Symlink Patterns (2026-05-14)

Loose regex and missing symlink-boundary sentinels can evade code review; require explicit boundary guards (path.sep sentinel) and strict regex anchoring in file-write operations.

### Phase B Piece 03 Adversarial Review (2026-05-13)

Reviewed clones/origins resolver + init-mode guard (94/94 green). Found one MAJOR gap: CM.7 case-sensitivity test asserts only 	ypeof result === 'boolean' on both branches — passes regardless of return value. Cannot detect regression where case-insensitive matching silently returns alse on win32/darwin. Found MINOR gaps: chain precedence tests cover steps 1>2, 2>4, 4>6 but miss 3>4 (SQUAD_CALLSIGN vs clones), 5>6 (origins vs platform), 6>7 (platform vs worktree). Trailing slash normalization and clones:[] empty array untested (code handles both, path.resolve and length guard). Piece-02 regression confirmed clean: matchedOrigin: null on source='local' still asserted via toMatchObject. VERDICT: APPROVE.

Pattern: Tests follow existing 	est/cli/init.test.ts and 	est/cli/doctor.test.ts conventions — vitest, andomBytes temp dirs in cwd, imports from compiled dist via package exports (@bradygaster/squad-cli/core/init, @bradygaster/squad-cli/commands/doctor, @bradygaster/squad-sdk).

Commit: 7660a27 on branch squad/579-init-scaffolding-hardening.

### Piece 02 adversarial review (2026-05-12T23:06:58-07:00)

**Verdict:** CONDITIONAL (2 blocking findings, 5 should-fix items all addressed in remediation commit  5bd332f)

**Blocking issues identified:**
1. **Test isolation failure** — Tests 2.4 and 2.5 inherit process.env.SQUAD_CALLSIGN when opts.env not set. Env not pinned, exposing test state leakage.
2. **Empty callsign gap** — opts.callsign = '' path entirely untested.

**Should-fix items (all resolved in remediation):**
- Tautological priority test (test input identical to expectation)
- Three-way priority case unexercised in test suite
- Registry path priority partially tested (missing platform-default + env-var coverage)
- Error categorization opaque (CONFIGURATION category doesn't discriminate four distinct failure modes)
- Conditional priority logic clarity (test naming and assertions could be stronger)

**Test remediation summary:** Commit  5bd332f added 11 new tests (17 → 28 total), pinned opts.env across all test cases, closed both blocking gaps, and implemented typed error codes (ResolveErrorCode union) for downstream CLI discriminability. All tests green. FIDO approval conditional on acceptance of architectural decisions (error model, -v2 naming).

### Piece 08b Adversarial Review (2026-05-14T16:12:01.302-07:00)

**Verdict:** REJECT — reassign to Sims.

All 30 tests pass (16 migration + 14 consult). Parity is structurally present but has four blocking gaps:

1. **Consult setup-mode success path absent.** The spec requires every user-action command's success path to be covered. The only consult success test exercises `--status`, which bypasses the resolver guard by design (`showStatus` check). The guarded setup-mode path is untested in the green direction.

2. **`.gitignore` non-mutation unverified.** Both the consult and link failure-path tests only check `config.json`. The spec explicitly requires asserting that `.gitignore` / ignore entries are not written. A regression that writes an ignore entry before the guard exits would pass the existing tests.

3. **Three assign-to-copilot failure modes absent.** The spec test surface lists URL-without-clone-destination, clone failure, and host verification failure as required. The implementation does not include these features, and the tests can't cover what isn't there. Scope gap: requires a product decision before tests are written.

4. **Dead `resolved` variable in consult and link dispatch.** `cli-entry.ts` computes the guard resolution but never passes it to `runConsult` / `runLink`. The runner may re-resolve from different context. No test surfaces a divergence.

**Pattern learned:** Guard-only tests (prove failure-path exit) are not sufficient when the spec also requires success-path verification and side-effect non-mutation assertions on ignore entries. Always check: (a) is the success path exercised for every guarded command? (b) are ALL named spec side effects (not just config.json) explicitly asserted absent in failure paths?

## Archive

Older learnings (prior to 2026-05-14) have been archived to history-archive.md for reference.

---

---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.
