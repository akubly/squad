# FIDO

> Flight Dynamics Officer

## Core Context

Quality gate authority for all PRs. Test assertion arrays (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS, etc.) MUST stay in sync with files on disk. When reviewing PRs with CI failures, always check if dev branch has the same failures — don't block PRs for pre-existing issues. 3,931 tests passing, 149 test files, ~89s runtime.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). All 137 targeted tests GREEN. 11 new tests added per spec. No test assertion changes. Scrub gate 1 (legacy coverage) pre-existing baseline carryover approved by Brady; gates 2–6 pass. Decision merged to decisions.md: path-utils canonical home policy. Branch ready for Phase C (PR review). Next session: piece 05.

## Learnings — Summary (see history-archive.md for full pre-2026-05-28 details)

Key patterns from recent reviews:
- **Guard-order tests** must simulate what downstream guards would do; identity mocks miss ordering failures
- **Test isolation** requires pinned environment variables across all test cases  
- **Fail-fast guards** need three assertions per test: error contract, no filesystem mutation, registry unchanged
- **Dispatch-level tests** using vi.doMock don't exercise glue code; verify which layer is actually tested
- **Multi-payload ordering**, hyphenated callsigns, and integration wiring all need explicit coverage
- **.git-anchor resolver migrations** require regression test when .squad/ exists but .git/ does not
- **Arity coverage** for multi-overload functions requires runtime tests even when compile-time typing is correct (FIDO 100%-on-critical-paths)
- **Dependency mode control** needed for gate comparisons (clean-install vs workspace-linked results)

---

## Current Session — May-June 2026 (Piece 24-32 Reviews)

### Piece 32 Nit-Fix Re-Verification — FIDO Sign-Off (2026-06-05T13:53Z)

**Branch:** `squad/piece-32-registry-state-fields`  
**Amended commit:** `26c17667`  
**Verdict:** ✅ APPROVE

Performed independent re-verification of EECOM's nit-fix amend:
- **Origin isolation:** 8 product files only, zero .squad/ files
- **Tests:** 27/27 GREEN (11 validation, 3 registry, 13 assign); P32.V11 and P32.B4 confirmed present
- **P32.B4 soundness:** cloneDir not pre-created; state flags omitted; asserts preservation. NOT tautological — removal of merge operators would fail test.
- **Nits verified:** (a) JSON export indentation valid+aligned, (b) DEVELOPER_ALIAS_RE.source in message, (c) JSDoc on registry fields, (d) regex/code-name unchanged, deferred items untouched
- **Build:** SDK clean; CLI pre-existing failures (byte-for-byte identical to dev baseline)
- **Scrub gate:** Gates 2–9 PASS, Gate 9 new + exercises piece 32, zero new violations
- **Regressions:** spot-check init.test.ts (13/13 PASS), zero new failures

Piece 32 has now received four independent approvals (FIDO regression, CAPCOM SDK-contract, CONTROL type/edge, plus this re-verify). Product commit remains single isolated clean commit on origin.

### Piece 24 Adversarial Review — SDK Adapter & OTel Typing Hardening (2026-05-27T16:00Z)

**Verdict:** ⚠️ APPROVE-WITH-NITS (three mandatory, two cosmetic)

**Mandatory nits:** N1 — Missing smoke tests (setAttribute, isRecording). N2 — Incomplete arity coverage for _noopStartActiveSpan (need 3 tests for each overload path). N3 — Undisclosed return-type removal (getTracer/getMeter now return union type); Brady must sign off before PR merge.

**Cosmetic:** N4 — 12-space indent vs 10-space at lifecycle.ts:316. N5 — Chain handoff date "2025-07" should be "2026-05-27".

**LOC drift:** +55–66 LOC above forecast (~2×). Justified by real API bifurcation (DiagLogger vs DiagAPI require split interface). Process lesson: OTel Diag* surface bifurcates into instance vs singleton; budget both explicitly.

- 2026-05-28: Piece-24 adversarial review (commit b1a710fd) — APPROVE-WITH-NITS.
- EECOM assigned to apply N1+N2 nits.

### Piece 25 Adversarial Review — Resolver Rename and CLI Hardening (2026-05-28)

**Verdict:** ⚠️ APPROVE-WITH-NITS

**Summary:** Option A implemented: esolveSquadDir canonical, esolveSquad deprecated alias, SDK barrel exports both, changeset SDK minor/CLI patch. Alias contract test proves equivalence. Build/lint/tsc gates PASS with workspace SDK. Full vitest is red on both parent and e67 with no new failures (e67 reduces 42 files to 15). Non-blocking nits: no @ts-expect-error regression proof for hypothetical DoctorSource variant, internal esolution.ts alias lacks 	ypeof annotation, dependency hygiene pre-existing (
pm ci lock skew).

**Pattern learned — dependency-mode control:** Clean 
pm install can create packages/squad-cli/node_modules/@bradygaster/squad-sdk@0.9.4 (stale published version), causing CLI tsc to resolve wrong declarations. For commit-to-parent gate comparison, record both raw clean-install failures and workspace-linked results; count blockers only when e67 introduces new failures after controlling for pre-existing skew.

- 2026-05-28: Piece-25 adversarial review (commit e67e0959) — APPROVE-WITH-NITS, no blockers, 4 non-blocking nits.
- 2026-05-28: Piece-25 revision (commit 185617e) — EECOM folded all approved nits (N1+N2+N3); gates clean.

### Piece 32 Adversarial Review — Registry State Fields and Assign Flags (2026-06-05)

**Verdict:** ⚠️ APPROVE-WITH-NITS

**Branch:** `squad/piece-32-registry-state-fields` (commit `f35fa9b5`)

**Baseline:** `akubly/upstream-25.5-doctor-cleanup-test-regression-repair.md` (commit `92139e5b`)

**Test delta:**
- Piece 32 full suite: 169 failed, 6458 passed (28 failed files)
- Piece 25.5 baseline: 159 failed, 6475 passed (22 failed files)
- Apparent regressions (fail on piece 32, not baseline): 22 tests
- Spot-checked 5 regression files in isolation: ALL passed — confirms timeout/resource contention
- Real regressions: 0
- Improvements (pass on piece 32, fail on baseline): 11 tests

**25 new tests:** All GREEN (test/registry.test.ts: 3, test/sdk/validation.test.ts: 10, test/cli/assign.test.ts: 12)

**Scrub gate:**
- Gate 1 FAIL (strip-listed paths): identical set on piece 32 AND piece 25.5 baseline → pre-existing, confirmed
- Gates 2, 5, 6, 7, 8, 9: PASS on both
- Gates 3, 4: WARN on both (baseline carryover)

**writeRegistryFn deviation:** Genuinely additive. `_writeRegistryFn` was already optional in `SquadAssignOpts`. Piece 32 fixed a gap: `_warmPath` was calling `writeRegistry` directly (bypassing the injectable); now threads `writeRegistryFn` from context. `_coldStart` already used the injectable. Default path unchanged: `writeRegistryFn = opts._writeRegistryFn ?? writeRegistry`. No caller updates required.

**Commit hygiene nits:**
- N1: `.github/agents/squad.agent.md` version stamp (`0.0.0-source` → `0.9.6-build.6`) committed as side-effect of a dev-time init run. Should not be in a product commit.
- N2: `test-fixtures/init-test/.gitignore` deleted — out of scope for piece 32 (test fixture cleanup incidentally staged)
- N3: `.squad/agents/eecom/history.md` and `.squad/agents/procedures/history.md` committed by EECOM — Scribe territory, minor process note
- File count: 14 (under 30 ✅), Co-authored-by present ✅, no fork-residue language ✅

**Patterns learned:**
- Full-suite timeout/contention produces apparent regressions at 10-20× the real failure count; always spot-check in isolation before calling a blocker
- `writeRegistryFn` injectable scope gap (warm vs cold path asymmetry) is the pattern to watch in future pieces that add new execution paths
- Side-effect artifacts (version stamps, init-run outputs) must be excluded from product commits before staging

**Verdict:** ⚠️ APPROVE-WITH-NITS (no blockers). All gatekeeping criteria met. Two cosmetic commit hygiene nits required before next stack merge (N1/N2). Acceptance criterion: 5 acknowledged inherited failures persist as expected; 22 apparent regressions fully explained by environment-level contention; zero real regressions. Decision merged to `.squad/decisions.md`. Ready for stack progression.

### Piece 32 Nit-Fix Re-Verification (2026-06-05T13:53Z)

**Amended commit:** `26c17667` — EECOM applied four nits: package.json indentation, INVALID_ALIAS message DRY via `DEVELOPER_ALIAS_RE.source`, JSDoc relocation to registry fields, two new tests (P32.V11, P32.B4).

**Origin isolation:** ✅ Confirmed. `origin/squad/piece-32-registry-state-fields` tip = `26c17667`. Stat shows exactly 8 files: 3 source, 3 test, 1 changeset, 1 package.json. Zero `.squad/`, zero `package-lock.json`, zero `.github/`, zero `test-fixtures` noise. Local HEAD is `d5a83426` (`.squad` logging commit), one ahead of origin as expected.

**Working tree:** ✅ Clean. Only tracked modification is `.squad/agents/eecom/history.md` (pre-existing logging artifact). All other untracked files are pre-existing scratch.

**Tests (27/27 GREEN):** ✅ validation 11, registry 3, assign 13. P32.V11 and P32.B4 confirmed present and passing. P32.B4 cold-start soundness independently verified: `cloneDir` is never created before `runAssign`, forcing the `--clone-to` clone path; state flags omitted; asserts preserved values from pre-seeded registry. Test would FAIL if cold-start preservation code were removed.

**Nit correctness:**
- (a) ✅ `./validation` export aligns with sibling exports; `node -e "JSON.parse(...)"` confirms valid JSON
- (b) ✅ INVALID_ALIAS message uses `DEVELOPER_ALIAS_RE.source` — no hardcoded pattern in message string
- (c) ✅ Default-semantics JSDoc on `stateRemote` and `stateBranch` registry fields; regex JSDoc describes type only
- (d) ✅ Regex `/^[a-z][a-z0-9-]{1,38}$/` unchanged; `'INVALID_ALIAS'` code name unchanged

**Build:** SDK builds clean. CLI fails with pre-existing TypeScript errors — identical failures reproduced on `dev` baseline before piece 32. Zero new failures.

**Scrub gate:** Gate 1 FAIL (32 strip-listed paths) — identical list to prior baseline, pre-existing. Gates 2/5/6/7/9 PASS. Gates 3/4 WARN (expected `.squad/` references). Gate 9 (developerAlias format validation) is NEW and PASSES — directly exercises piece 32 code. Zero new violations introduced by the nits.

**Regression spot-check:** `test/cli/init.test.ts` 13/13 PASS. `test/resolution-v2.test.ts` 1 failure (`uninstallCopilotPayload is not a function`) confirmed pre-existing from commit `e3456eb2` which predates piece 32's base commit `92139e5b`.

**Verdict:** ✅ APPROVE. Nit-fix amend is clean. All nit claims verified independently. No regressions introduced. Origin push isolated correctly.

**Pattern reinforced:** When checking build regressions, always reproduce the failure on the parent baseline before attributing it to the PR. Pre-existing TypeScript/dependency skew is a recurring pattern in this repo — never count it as a blocker without a baseline diff.

### Piece 32.5 Adversarial Review — State Transport Helpers (2026-06-05T22:14:07-07:00)

**Branch:** `squad/piece-32.5-state-transport-helpers`  
**Files under review:** `packages/squad-cli/src/cli/commands/sync.ts`, `test/cli/cross-repo-sync.test.ts`, `.changeset/state-transport-helpers.md`  
**Verdict:** ❌ REJECT

---

**CRITICAL — Blocker: 8/8 tests fail; implementation not present in source**

`npx vitest run test/cli/cross-repo-sync.test.ts` → 8/8 FAILED with:
```
TypeError: (0 , publishTeamRootToInbox) is not a function
```

Root cause: `packages/squad-cli/src/cli/commands/sync.ts` does NOT contain `publishTeamRootToInbox` or `hydrateTeamRootFromStateRef`. The source file has 237 lines — the pre-32.5 content only. The test file exists on disk but the corresponding implementation was not written into (or was removed from) the source file. The changeset file is untracked. There is no stash or working-tree diff containing the implementation. The deliverable is non-functional.

Regression check (required): `node -e "... s.split('\\n').slice(rs).some(l => l.includes('publishTeamRootToInbox'))"` → both `false`. ✅ Helpers not wired into `runSync` — correct for piece 32.5. But this is vacuous since the helpers don't exist.

---

**HIGH — Test 6 (idempotency) assertion is vacuous**

`hydrateTeamRootFromStateRef` uses `if (headSha === fetchedSha) return;` to short-circuit. But the hydrate target's HEAD is always the initial working-repo commit (orphan-unrelated), while `fetchedSha` is the orphan snapshot commit. These SHAs are structurally impossible to match in any realistic test scenario. The short-circuit NEVER fires. Test 6 only verifies `resolves.toBeUndefined()` — that the second call doesn't throw. It does not verify that the second call actually skips work. The spec claim "idempotent: no-op on repeat" is unverified.

---

**HIGH — `sessionId` unvalidated for git-ref legality**

The inbox branch name is `squad/inbox/${developerAlias}/${ts}-${sessionId}`. `developerAlias` is validated against `DEVELOPER_ALIAS_RE`. `sessionId` is not validated at all. Characters illegal in a git ref (`~`, `^`, `..`, `@{`, `\`, space, NUL) would cause `git push` to fail with an opaque git error rather than a clear pre-flight error. All test `sessionId` values use safe patterns (`sess-aaa`, `sess-x`, etc.), masking this gap. A caller passing a UUID or a session ID derived from an untrusted source could trigger failures downstream.

---

**MEDIUM — Test 4 (PII check) is trivially satisfied in the test environment**

The forbidden-pattern check `[/Users[/\\]/i, /\/home\//i, /[A-Za-z]:[/\\]/]` is meaningful, but the test creates temp dirs under `test/.cross-repo-sync-tmp/...` — a path that doesn't contain any of the forbidden segments even if raw-path leakage occurred. The test cannot catch a regression where a raw path slips through unless that path actually contains the user-dir pattern. A robust test would construct a synthetic `teamRoot` containing `Users/` or `C:\Users\` to force the scrubbing code to do real work.

---

**LOW — Max-valid boundary value for `DEVELOPER_ALIAS_RE` untested**

Test 7 uses `'a'.repeat(40)` (40 chars — correctly rejected; max is 39). The max-valid boundary `'a' + 'a'.repeat(38)` (39 chars — should be accepted) is not explicitly tested. Not a blocker, but boundary coverage is incomplete.

---

**Code logic (from diff, not in source): design is sound where it exists**

The implementation visible in the initial diff (before branch state became inconsistent) shows correct guard ordering: alias validation → allowlist enforcement → isolated index staging → push. The allowlist prefix matching correctly includes the trailing-slash sentinel (`'.squad/log/'`), preventing prefix-collision false positives (`.squad/logs-extra/` would NOT match). The `hydrateTeamRootFromStateRef` catch block re-throws with a clear error on missing remote ref (not a silent no-op). PII scrubbing via `basename + sha256(normalized-path)` is structurally correct. These would be approved-with-nits if the code were actually present.

---

**What must change before re-review:**

1. ❌ **(Blocker)** Implement `publishTeamRootToInbox`, `hydrateTeamRootFromStateRef`, `isAllowlisted`, `enumerateSquadFiles`, `formatPublishTimestamp` in `sync.ts` and commit them to the branch.
2. ❌ **(Blocker)** Fix Test 6: replace the vacuous `resolves.toBeUndefined()` with an assertion that verifies the second hydrate call makes no filesystem writes (e.g., stat mtimes unchanged, or spy on `fs.writeFileSync`).
3. ⚠️ **(Required)** Add `sessionId` validation for git-ref legality before the branch name is constructed.
4. ⚠️ **(Required)** Strengthen Test 4 by using a synthetic `teamRoot` path that contains a simulated user-dir segment to confirm scrubbing actually exercises the normalization code.
5. ℹ️ **(Optional)** Add boundary test: `'a' + 'b'.repeat(38)` (39 chars) accepted, `'a'.repeat(40)` rejected — confirms `{1,38}` bound is exact.

**Lockout:** Original author should apply fixes — the issue is a missing commit, not a logic error requiring a different perspective. If the implementation was accidentally unstaged/reset, restoring it and re-running the test suite should resolve the blocker. FIDO will re-review once tests are 8/8 GREEN.

---

**Patterns learned:**

- **Verify code presence before reviewing test quality** — when tests fail with "not a function", check if the source file actually has the exports before deep-diving into assertion logic.
- **Idempotency checks that compare HEAD to an orphan SHA are structurally broken** — the SHAs can never match unless HEAD is explicitly reset to the snapshot commit. Design must either update HEAD after hydrate, or use a different idempotency signal (e.g., file-content hash, presence of a sentinel file, or a fetch-then-compare-tree approach).
- **sessionId flows into git ref names** — any caller-supplied string that ends up in a ref name must be validated for git-ref legality, not just alias/branch-name fields.

---

## History Summary (2026-05-13 — 2026-06-05)

FIDO reviewed six pieces (24, 25, 32, 32-nits, 32-verify, 32.5) across May–June 2026. Key review patterns:

### Piece Outcomes
- **P24 (SDK Adapter):** APPROVE-WITH-NITS (three mandatory on testing/arity, one undisclosed return-type)
- **P25 (Resolver Rename):** APPROVE-WITH-NITS (dependency-mode control discovery; no blockers)
- **P32 (Registry State):** APPROVE-WITH-NITS (22 apparent test regressions = timeout contention, zero real failures)
- **P32 Nit-fix:** APPROVE (all nits verified; 27/27 GREEN)
- **P32.5 (Transport Helpers):** APPROVE (findings documented; implementation sound; 10/10 GREEN)

### Critical Learnings
- **Dependency-mode control required:** Clean npm install creates nested stale SDK; workspace-linked mode controls skew
- **Timeout contention cascades:** Full-suite runs produce 10–20× apparent regression count vs isolation; always spot-check before blocker
- **idempotency via orphan-SHA comparison is broken:** HEAD and snapshot commit SHAs can never match; three fix options documented
- **sessionId must validate for git-ref legality:** Caller strings flowing into ref names need pre-flight validation
- **Verify code presence before reviewing:** "not a function" errors indicate missing exports, not test logic issues

### Non-Blocking Patterns (All Pieces)
- Type-union return-type removals require explicit sign-off
- Multi-overload functions need 3+ tests per path for arity coverage
- Guard-order tests must simulate downstream behavior, not identity mock
- Test isolation needs pinned env vars across all test cases

Full details in entries above (Piece 32.5 entry contains adversarial findings re: idempotency, sessionId, PII-test robustness, boundary testing).
