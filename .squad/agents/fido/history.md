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
- 2026-05-28: Piece-25 revision (commit 185617e) — EECOM folded all approved nits (N1+N2+N3); gates clean.

---

## Archive — Older Learnings (see history-archive.md for pre-2026-05-28 full details)
