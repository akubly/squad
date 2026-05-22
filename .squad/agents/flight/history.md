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
