# Flight — Project History (Summarized)

> Knowledge accumulated through leading Squad development.

---

## Archive

See history-archive.md for learnings from pieces 02–35 (wave 1-phase B pilots, crash recovery, dual-doctor unification, resolver rename, piece 25-35 gates and constraints).

**Recent summarization:** Consolidated pieces 25, 32.5, 33, 34, 35 constraint-compliance patterns into archive on 2026-06-10. Retained piece 36+ and forward-looking learnings.

---

## 📌 Piece 36 Scope Decision (2026-06-08)

Nine defects in the cross-repo assign→commit→publish→fold loop are upstream defects (sub-proposals A–I). All accepted for implementation. One class of defect explicitly excluded: test import scope mismatch (fork-local concern from SDK package rename on this branch). Per scrub-gate Gate 2, scope names must not appear in spec — only neutral behavior description allowed.

**Critical set (loop-blocking):** A (assign flag wiring), C (recursion-guard bug), D (allowlist throw vs. filter), E (template resolution path).

**Binding note:** Scrub gate Gate 2 is a simple text scan — it treats any occurrence of target scope names as a failure, with no allowlist for documentation contexts. When writing specs involving SDK rescope, describe desired behavior without naming the scope.

---

## Learnings: Piece 36 Scope Decision (2026-06-08)

Nine defects in the cross-repo assign→commit→publish→fold loop are upstream defects (sub-proposals A–I) — they exist in the product source and will affect any consumer. One class of defect was explicitly excluded: test import specifiers that reference the wrong package scope in test files are a working-branch-local concern caused by the branch's SDK package rename and must not be named in the upstream spec (naming an alternate package scope would violate Gate 2 of the scrub gate). The replay implementer is directed neutrally to align new test imports with the existing test files' package scope, without any scope name appearing in the spec or kickoff prompt.

Critical set (loop-blocking): sub-proposals A (assign flag wiring), C (recursion-guard bug in hook body), D (allowlist throw vs. filter), E (template resolution path in published package). All four must be resolved before the cross-repo loop can complete a single end-to-end cycle.

**Scrub gate scope-naming constraint:**
The scrub gate (Gate 2) treats any occurrence of \wifi-aware\, \wifi.aware\, or \@wifi-aware\ as a hard failure regardless of context — including as a negative example or a quoted package name. When writing specs or kickoff prompts that involve SDK package scope, describe the desired behavior (e.g., "align with the existing test files' import pattern") without naming the alternate scope. The Gate 2 check is a simple text scan with no allowlist for documentation contexts.
