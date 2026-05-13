# Decision: Rename PRs require non-BC test suite grep for old name

**Date:** 2026-05-13T11:28:28.990-07:00  
**Author:** EECOM  
**Trigger:** Piece 04 revision — S14b finding

## Context

When a piece renames a public API (e.g., `registerEntry` → `upsertEntry`), the rename must propagate into all internal test usages in the same commit. The `BC.1` test may legitimately retain the old name to document backward-compatibility behavior. All other internal test call sites must use the new name.

The piece 04 implementation missed one call site: `S14b` continued calling `registerEntry` after the rename landed.

## Decision

**Any PR that renames a public API must include a `grep` sweep of the full test suite for the old name, with results documented in the PR body or commit message.** Call sites falling outside the explicit backward-compatibility describe block are non-BC usages and must be updated.

The sweep command:
```
grep -rn "oldName" test/ packages/*/test/
```

Acceptable residuals: imports (if needed for BC tests), BC describe block contents, deprecated alias definitions in source, re-exports in index.ts.

Everything else is a finding.

## Rationale

Rename correctness is not just about making the build pass. Tests that call the old name under an internal describe block give a false signal: they verify the deprecated alias rather than the canonical API, silently undermining the intent of the rename. The sweep is mechanical (takes under a minute) and should be a reflexive step for any rename piece.
