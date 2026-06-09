# Orchestration Log — CONTROL Doc + B3 Follow-up Polish

| Field | Value |
|-------|-------|
| **Agent routed** | CONTROL (TypeScript Engineer) — post-verification polish |
| **Why chosen** | After GO verdict, CONTROL (the neutral remediation agent) performs final doc-truthfulness and test-assertion polish to ensure commit hygiene and spec compliance. |
| **Mode** | `sync` |
| **Why this mode** | Polish is final, blocking-free sync work before ship. No external dependencies. |
| **Files authorized to read** | Amended commit `bc2e54e4`, `.squad/decisions/inbox/piece-36-triage.md`, piece-36 implementation notes, spec cross-references |
| **File(s) agent must produce** | Final amended commit with corrected docs and B3 behavioral assertion |
| **Outcome** | **Completed** — Final amended commit `feee37f7` pushed. Fixed doc-truthfulness in `.squad/decisions/inbox/piece-36-triage.md`: corrected E (install-fold-pipeline template path) from 2-level `../../` to 3-level `../../../` path in triage notes and docs to match actual implementation. Added Documented Residual Limitations section clarifying H (sentinel staleness), I (cross-process collision edge), and C (GitHub CI follow-up for hook non-reentry end-to-end). Upgraded B (--skills-from wiring) test B3 to include behavioral value-binding assertion (verify flag value reaches runAssign correctly, not just presence). Verified 23/23 piece-36 tests GREEN, zero pre-existing scrub violations, build clean. Ship-ready. No further commits. |

---

## Summary

CONTROL performed final doc-truthfulness and test-assertion polish. Corrected E path documentation (3-level, not 2-level). Added comprehensive Documented Residual Limitations section. Upgraded B3 test with behavioral value-binding assertion. All 23 tests GREEN, build clean, scrub gate passed. Commit `feee37f7` is final, ship-ready product state. No PR required (replay branch, squashed commit). Ready for team archive and decision merge.
