# Procedures Decision — shared upgrade-managed file conventions

**Date:** 2026-05-22

## Context

Piece 21 FIX-3/FIX-9 added legacy doctor checks for artifacts managed by `squad upgrade`. Two convention lists, `.gitattributes` merge rules and `.gitignore` entries, were previously declared inline in `upgrade.ts`, but doctor needs to validate the exact same contract.

## Decision

Create `packages/squad-cli/src/cli/core/squad-file-conventions.ts` as the single source of truth for `GITATTRIBUTES_RULES` and `GITIGNORE_ENTRIES`. Both `upgrade.ts` and `doctor.ts` import the constants from that module instead of duplicating them.

## Consequences

- Upgrade and doctor cannot drift on required repository convention entries.
- Future artifact checks should prefer shared convention modules over re-declaration.
- The module remains dependency-light and safe for CLI core imports.
