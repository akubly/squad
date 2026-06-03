# FIDO

> Flight Dynamics Officer

## Core Context

Quality gate authority for all PRs. Test assertion arrays (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS, etc.) MUST stay in sync with files on disk. When reviewing PRs with CI failures, always check if dev branch has the same failures — don't block PRs for pre-existing issues. 3,931 tests passing, 149 test files, ~89s runtime.

📌 **Team update (2026-06-02T22:35:00Z — Piece 30 Adversarial Review):** FIDO conducted quality-focused adversarial review of piece 30 ADO templates (commit 10168051); verdict: APPROVE-WITH-NITS. Identified 1 mandatory finding: no execution-based idempotency test for `bootstrap-cross-repo.ps1` — regex-only source scans insufficient to catch logic bugs in PS1. Additional 4 non-blocking observations on guard ordering, trigger structure, step-content assertions, URL validation. Piece passes overall quality bar; mandatory finding requires test coverage before merge. Consolidated to REJECT verdict by Flight (due to CAPCOM/Booster/RETRO mandatory blocking items).

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). All 137 targeted tests GREEN. 11 new tests added per spec. No test assertion changes. Scrub gate 1 (legacy coverage) pre-existing baseline carryover approved by Brady; gates 2–6 pass. Decision merged to decisions.md: path-utils canonical home policy. Branch ready for Phase C (PR review). Next session: piece 05.

📌 **Team update (2026-06-02T19:27:39Z — Piece 28 Revision R2 Complete):** Your FIDO adversarial findings (CRITICAL allowlist, atomic metadata, fail-closed behavior) were fully addressed in CONTROL R2 commit aff12874. Flight gate approved; all mutation guards confirmed live (28/28 tests pass in isolation).

📌 **Team update (2026-06-02T21:55:00Z — Piece 30 ADO Templates Complete):** test/template-sync.test.ts extended with 12 new ADO mirror assertions: 3 canonical existence checks + 9 mirror parity checks (3 templates × 3 mirrors). ado-templates.test.ts (new) validates YAML-parse gates, no-PR-trigger gate (publish-inbox.yml), trigger pattern, no broad OAuth, sole-writer comment, idempotency guards. All 190 tests pass.

📌 **Team update (2026-06-02T21:16:49Z — Piece 29 Nit Revision Complete):** All 3 mandatory nits resolved (Flight, PAO identified M1+M3; Flight identified M2). Your mutation-test verification pass on baseline team-root-work-root-protocol.test.ts (+45 new assertions) gave confidence for revision. SHA b7ff4f99 pushed. Tests: 223/223 green. Scrub-gate zero new violations. Ready for Phase C.

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

## Current Session — May 2026 (Piece 24-25 Reviews)

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

📌 **Piece 27 Nit Revision Landed (2026-06-02T01:00Z):** Flight (Lead) completed amendment commit `5d8509f4` on `squad/piece-27-explicit-sync-command`. FIDO N1 and N2 nits fully resolved: N1 whitespace-only `--developer " "` now rejected before git ops (10 test cases); N2 `installHook(force:true)` idempotent (1 new test, suite now 16/16). Both revisions verified; recursion guard PASS. Decision merged; branch push confirmed.
- 2026-05-28: Piece-25 revision (commit 185617e) — EECOM folded all approved nits (N1+N2+N3); gates clean.

---

---

## Piece 27 Adversarial Review — Explicit Sync Command (2026-06-01T13:39:10.278-07:00)

**Verdict:** ⚠️ APPROVE-WITH-NITS (2 mandatory, 3 non-blocking)

**Commit reviewed:** 31177e72 on branch `squad/piece-27-explicit-sync-command`

**Mandatory nits found:**
- **N1 — Whitespace alias bypass:** `if (!alias)` is a falsy check; `' '`, `'\t'`, `'\n'` all pass. Must be `!alias || !alias.trim()`. No test for whitespace/control-char developer inputs.
- **N2 — `--force` hook duplication bug:** `installHook()` force branch computes `cleaned` but never uses it (dead code). Falls through to chain block, doubling the squad section on each force reinstall.

**Non-blocking nits:** Flag-combo precedence untested; `--remote ""` silently ignored; `--both` + no-stateRemote untested.

**Learnings for future reviews:**
- Always probe `!alias` with whitespace inputs — JS falsy check misses `' '`. Standard pattern: `!alias || !alias.trim()`.
- Dead-code comments like `// simplified: just replace the file` are a red flag that a refactor was unfinished.
- Force-reinstall path in installer-type code must have a dedicated test to catch duplication bugs.
- `--pull --push` combined flags with last-if-wins precedence should be documented or tested; silent precedence is confusing UX.
- Baseline validation approach: run targeted tests on piece N-1 tip and compare failure lists. Wiring failures on `doctor-types.ts` and `init-remote.ts` confirmed pre-existing on piece-26.
- Build baseline validation: `npm run build` output on parent vs child — zero new errors is sufficient evidence for pre-existing claim.

## Archive — Older Learnings (see history-archive.md for pre-2026-05-28 full details)
📌 **2026-06-02 Piece 29 Coordinator Protocol — Cross-Repo Multi-Root Support (Commit b642f9cd):** Piece 29 protocol update establishes four-path coordinator model: TEAM_ROOT (canonical state), TEAM_SQUAD_DIR, WORK_ROOT (product repo), WORK_SQUAD_DIR (projection). Five spawn-contract variables now required for all agent dispatches. Write rules prohibit non-Scribe agents from modifying WORK_SQUAD_DIR directly. State publication via squad sync --push only. Scrub gates verified clean; zero new violations vs piece-28 baseline.

## Learnings

- **indexOf-with-colon pattern** for spawn-variable ordering assertions (e.g., `content.indexOf('WORK_ROOT:')`) doubles as a rename-detection guard — if the variable name changes, indexOf returns -1, failing the > -1 check before the ordering check even runs. Useful trick for template governance.
- **Lookbehind-based negative guards** (e.g., `(?<!never|must not)` before a grant phrase) effectively detect accidental permission drift in prompt templates without flagging the prohibition itself. Remember this for future write-discipline tests.
- **Stray .tmp files** from sync-templates.mjs can break the "no extra files" guard in template-sync tests. Always check for and clean untracked artifacts before concluding test failures are real regressions.
- **Gate-1 "changed file count"** is the only metric expected to differ between parent and child commits; all other gate results should be byte-identical for a baseline-clean piece.
- **Source-reading tests are not execution tests.** A regex scan confirming a guard pattern exists in a PS1 file does not verify the guard fires at runtime, triggers before the first write, or that the idempotency logic is correct. When the spec requires behavioral idempotency, require an execution test (even in a sandbox). "Confirmed via source reading" is not a valid substitute.
- **JSON.stringify trigger dump is a shallow structural check.** `toContain('squad/inbox')` on `JSON.stringify(trigger)` catches value removal but misses YAML key-name mutations. For stronger trigger fidelity, assert on `parsed.trigger.branches.include` directly.
- **`not.toHaveProperty('pr')` is robust.** This catches `pr: none`, `pr: {}`, `pr: []`, and `pr: null` — all forms where the key is present. It does NOT false-positive on `# pr:` (comment) because YAML parsers strip comments. Good pattern for trigger-absence gates.
- **Belt-and-suspenders in template-sync tests is fine.** When section 2 dynamic enumeration already covers a file via `collectFiles` recursion, a named static assertion in section 8 is redundant but harmless — it produces better error messages on failure. Don't remove; do add for every explicitly spec'd file set.
- **Piece-30 review (2026-06-02):** APPROVE-WITH-NITS. 1 mandatory (no execution-based idempotency test for bootstrap-cross-repo.ps1). 4 non-blocking (guard ordering text-only, trigger structural fidelity, no step-level squad-state invariant, DocsRepoUrl URL format unvalidated). Test count 190/190 verified.
