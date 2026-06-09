# Orchestration Log — CAPCOM Adversarial Review Piece 36 (NO-GO)

| Field | Value |
|-------|-------|
| **Agent routed** | CAPCOM (SDK Expert) — model: Opus (adversarial hypothesis: "the fix is wrong") |
| **Why chosen** | CAPCOM is a domain expert (SDK, cross-repo patterns); adversarial review with different model (Opus) to inject skepticism and hunt for defects masked by passing tests. |
| **Mode** | `sync` |
| **Why this mode** | Adversarial review is a blocking verification gate. Verdict gates downstream remediation workflow. |
| **Files authorized to read** | Commit `9474a1d7`, piece-36 triage, all piece-36 test files, install-fold-pipeline.ts implementation, sub-proposal E path resolution logic |
| **File(s) agent must produce** | Adversarial review findings, NO-GO/GO verdict with critical defect enumeration |
| **Outcome** | **NO-GO** — **CRITICAL DEFECT-1 FOUND:** Sub-proposal E (template path for `install-fold-pipeline`) implemented with double-`fold` segment: `templates/fold/fold/<platform>/...` instead of `templates/fold/<platform>/...`. The path construction used `path.join(TEMPLATES_ROOT, 'fold', platform, ...)` but TEMPLATES_ROOT already resolved to `templates/fold/`. This breaks the command and causes **5 regressions in piece-35 test suite.** CAPCOM also found: tautological tests (E1/E2, B1/B2 pairs), weak C E2E coverage, and idempotency guard (H) that never fires. Verdict: **Ship blocked. Remediation required under lockout.** |

---

## Summary

CAPCOM's adversarial review (Opus, assumed-wrong hypothesis) uncovered CRITICAL DEFECT-1 in sub-proposal E: template path double-`fold` bug that breaks `install-fold-pipeline` and regresses 5 piece-35 tests. Additionally flagged tautological tests and incomplete E2E coverage. Verdict: **NO-GO.** Defect is production-breaking; remediation locked (EECOM excluded). Handoff to CONTROL for neutral fix.

This round demonstrates the value of adversarial review: it caught a defect that passed round 1 (FIDO's primary QA). The defect would have shipped without this step.
