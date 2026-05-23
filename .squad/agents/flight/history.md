# Flight — Project History

> Knowledge accumulated through leading Squad development.

---

## Archive

See history-archive.md for learnings prior to Piece 05 (wave 1 pilots, crash recovery, adoption tracking, etc.).

### Piece 05 Deadlock Arbitration (2026-05-13)
EECOM + CONTROL locked out. Flight arbitrated: latent vitest concurrency race from added worker load (not logic regression). Root cause: `journey-error-handling` timing-sensitive under pool pressure. Verdict: APPROVE piece 05 for PR. Concurrency optimization deferred.

### Piece 02 Adversarial Review (2026-05-12)
APPROVE WITH CONDITIONS. Established SDK naming policy (no `-v2` in permanent names; rename post-piece-11a) and error model (typed ResolveErrorCode for downstream CLI branching). 17 → 28 tests, all green.

### Piece 03 Adversarial Review (2026-05-13)
APPROVE. 94 tests GREEN, spec-parity confirmed across all 21 test-surface bullets. Heuristic: URL canonicalization audits verify both directions (distinct forms → same, similar → distinct).

### Piece 06 Adversarial Review — Dispatch Coverage (2026-05-14)
Source-sniff tests can mask CLI dispatch gaps; require behavioral assertions for flag handling and real child-process spawning to catch entry-point arg parsing errors.

### Piece 08b Adversarial Review — Guard Location & Resolver Consistency (2026-05-14)
📌 **Flight verdict: APPROVE WITH NITS**

Piece 08b mixes dispatch-level guards (consult/link) with module-internal (assign), creating ambiguous precedent. Pattern: if one command guards at dispatch, ALL must. Dual resolver imports compound confusion. **Non-blocking nits:** reconcile resolver import path and move assign guard to dispatch level before 08c. FIDO REJECT (test gaps) overrides; Sims assigned revision owner.

### Piece 14 Adversarial Review — Findings Landed (2026-05-18)

📌 **Flight findings from piece 14 adversarial pass successfully addressed in revision.**

Initial review identified guard-ordering test gap (A15 identity mock doesn't prove ordering), plus 6 minor + 2 nit findings. CAPCOM revision delivered: injectable-seam guard-order test pattern documented in decisions; all minors addressed in code (multi-clone growth, origins dedup, inactive reactivation, filesystem assertions, forward-compat tests, cold-start orphan). Branch 1a47e601 + 935e73b2 ready for Phase C. Test A27 validates origins dedup; full suite 47 tests GREEN.



---

## 📌 Team Update — Piece 21 Ship Gate Cleared

**Date:** 2026-05-22  
**Event:** Post-stack-review gate clearance — all five required fixes shipped.

Piece 21 is now gate-cleared. Follow-up work (FIX-6 bulk stale-path repair, FIX-7 cross-platform path display, FIX-8 dual-doctor unification) is deferred to piece 22.

---

## Learnings

### Piece 22 Scope Decision (2026-05-22)

**Mechanical vs. enriched unification:** Chose mechanical-only scope for piece 22. The `DoctorFinding` type includes an optional `repair` field but piece 22 will NOT populate it — that's semantic enrichment for a later piece. Rationale: the dual-doctor debt has existed since piece 18 (4 pieces of compounding); the minimum viable fix is type unification + single renderer. Adding repair commands or correlated findings would triple the PR size and require new test infrastructure.

**Scope expansion decision:** Included D-4, D-7, D-12, D-15 in piece 22 because they are ≤5 LOC each, touch files already being modified, and avoid four separate PRs. Set a 200 LOC production-code ceiling as the expansion gate.

### Ship-Debt Sniff Methodology (2026-05-22)

Developed a systematic methodology for identifying technical debt across a multi-piece project:
1. Decision ledger walk (look for "deferred", "follow-up", conditional approvals)
2. Orchestration log scan (deferral keywords)
3. Literal markers (TODO/FIXME grep)
4. Escape hatches (eslint-disable, @ts-expect-error, @ts-ignore)
5. @internal audit (forced exposure vs legitimate encapsulation)
6. Duplication detection (same constant/function in 2+ files)
7. Resolver sprawl (same SDK function wrapped differently per file)
8. Silent returns (functions that return early without caller signal)

**Key finding:** 18 debt items across pieces 1–21. Severity breakdown: 8S, 7M, 3L (but 2 of the L's are "won't fix"). The dual-doctor (D-1) was the only L-severity item requiring its own proposal. Most debt is M-severity single-file refactors that cluster into "typing hygiene" (piece 23) and "OTel hardening" (piece 24) themes.

### Pattern: Ship-speed debt concentrates at integration boundaries

The highest-severity debt items (D-1, D-5, D-18) all occur where a new piece added a module that interfaces with existing code through a seam rather than by extending the existing module. This is the "parallel module" anti-pattern — it's the fastest way to ship without breaking existing tests, but compounds into resolver confusion and type fragmentation. Future pieces should flag this pattern in adversarial review.

---

## Piece 22 — Dual-Doctor Unification (2026-05-22)

**Branch:** `squad/piece-22-unify-doctors` | **LOC:** 165 diff lines (126 added + 39 removed in production src, +35 for new `doctor-types.ts`). Net production delta: ~87 LOC. Well under 200 LOC ceiling.

### Key decisions

**Architecture:** `runUnifiedDoctor` lives in `cli/commands/doctor.ts` (the legacy layer) rather than a new file. This keeps the cli-entry.ts import surface minimal — one import, one function. The registry `runDoctor` (in `commands/doctor.ts`) stays unchanged as an internal helper; its tests pass with zero modifications.

**Exit-code change:** `error → 2` (was `error → 1`). Rationale: piece 14 established `process.exit(2)` as the convention for "operation blocked by state" errors. Using 1 only for unexpected/catch-block failures. The old exit-1 on registry doctor error was inconsistent with this convention. Noted in PR description and changeset.

**Test seam:** `runUnifiedDoctor` inherits the `copilotHome` option from the registry doctor opts so tests can pass a fake home directory and avoid reading the user's real `.copilot` directory. This seam is essential — the real `.copilot` directory may contain invalid callsigns (e.g., "gethelp.app") that cause `diagnoseCopilotPayload` to throw.

**Registry finding severity:** Used batch severity (the global `RunDoctorResult.severity`) applied uniformly to all registry findings. This is "existing behavior preserved" per spec §2.2. Per-finding severities in the registry doctor would require a deeper refactor deferred to a later piece.

### Spec contradictions found

**None.** The spec migration table was accurate for all 5 TODO-marked checks. The test migration guidance in spec §5 assumed `runDoctor` would be removed; instead it's kept as a deprecated export so existing tests work without assertion changes. This is a valid deviation — removing the export would have required a large test migration with zero behavior change.

### Acceptance checklist

- [x] `DoctorFinding` type in `cli/commands/doctor-types.ts`
- [x] All 5 `TODO(piece-22)` markers removed (grep confirms zero)
- [x] `cli-entry.ts` dual-banner block replaced with single unified pass
- [x] Exit code: error → 2, else 0
- [x] `passCount` in summary line
- [x] All existing doctor tests pass
- [x] New tests: source grouping, passCount, empty-findings, error finding shape
- [x] `DoctorCheck` marked `@deprecated`
- [x] `npm run build` passes
- [x] `npm run lint` passes
- [x] No new `eslint-disable` or `@ts-expect-error`
- [x] `.changeset/piece-22-unify-doctors.md` present (patch bump)

---

## 🔴 Piece 22 Adversarial Review — Doctor Unification (2026-05-22)

**Status:** 🛑 REJECTED (2 blockers)

**Commit:** `ef09d3d3` on `squad/piece-22-unify-doctors`  
**Verdict:** REJECTED — Flight locked out per strict protocol  
**Revision candidate:** CONTROL (recommended)

**Blockers:** 
1. **cli-entry.ts warn-to-stdout bug:** Spec §2.3 requires "warn → 0 (warnings to stderr)". Implementation uses `console.log` for all severities. Comment contradicts code. Fix: route `f.severity === 'warn'` to `console.error()` or `process.stderr.write()`.
2. **Missing cross-source severity escalation test:** Spec §5 mandates: "A test where system doctor produces `warn` and registry doctor produces `error` → overall exit code is 2." Core behavioral claim of unification. All 5 new tests run against a healthy scaffold (zero errors). Fix: add a test scenario mixing `warn` and `error` findings from both sources.

**Non-blocking:** list-doctor tests, native registry migration, per-finding granularity, weak pre-existing gate.

**Pattern learned:** Warn-to-stderr contracts require verifying BOTH exit code AND stream routing in the renderer. Comment intentions ≠ code. Always grep for `console.log` in severity-keyed render helpers.

**Learnings for CONTROL revision:**
- Directive 1: Exit-code derivation needs a `never`-guarded helper, not inline `.filter()`.
- Directive 2: `DoctorSource` grouping needs exhaustiveness assertion or Map-based dispatch.
- Directive 3: `DoctorFinding` fields should be `readonly` to enforce immutability of value objects.

---

## 📌 Piece 22 Revision Approved — Flight Lockout Lapsed

**Date:** 2026-05-22  
**Revision commit:** `78297559`  
**Revision author:** CONTROL  

The artifact `squad/piece-22-unify-doctors` (commit ef09d3d3) that was locked out from Flight following rejection has now been approved on CONTROL's revision (commit 78297559). Both blockers resolved:
1. warn→stderr routing fixed in `renderFinding()`
2. Cross-source escalation test added with full gate coverage

All gates green: build CLEAN, lint CLEAN, 53/53 doctor tests, 159/200 LOC budget, no .squad/ leaks. FIDO re-verdict: ✅ APPROVE. Lockout for this artifact has lapsed.
