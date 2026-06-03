# FIDO — History Archive

> Cumulative learnings from quality reviews prior to 2026-06-02. Earlier history moved here for readability.

## Summary

Archive of FIDO's history from pieces 1–24 and foundational quality gate work (2025–2026). Covers test assertion governance patterns (EXPECTED_GUIDES, EXPECTED_FEATURES, EXPECTED_SCENARIOS), gate methodology, dependency-mode control for baseline comparison, resolver rename CI lifecycle, and early adversarial review cycles (pieces 04, 08a, 19, 21, 24–25).

## Archived Patterns

- Guard-order tests must simulate downstream behavior; identity mocks miss ordering failures
- Test isolation requires pinned environment variables across all test cases
- Fail-fast guards need three assertions per test: error contract, no filesystem mutation, registry unchanged
- Dispatch-level tests using vi.doMock don't exercise glue code
- Arity coverage for multi-overload functions requires runtime tests even when compile-time typing is correct
- Dependency-mode control is essential for gate comparisons (clean-install vs workspace-linked results)
- .git-anchor resolver migrations require regression test when .squad/ exists but .git/ does not

## Current Focus

Main history.md active learnings: pieces 27–30 review findings, test gate methodology, mutation-based validation strategy.
