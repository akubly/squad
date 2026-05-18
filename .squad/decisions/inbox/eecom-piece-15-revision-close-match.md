# Decision: Shared close-match helper — piece 15 revision

**Date:** 2026-05-18T16:19:28-07:00  
**Author:** EECOM  
**Subject:** Extract `findCloseMatch` to shared `lib/close-match.ts`

## Context

Both `assign.ts` and `unassign.ts` independently contained a 25-line Levenshtein/prefix-suggestion helper (`_findCloseMatch`). The duplication was flagged by Flight (F7) during adversarial review of piece 15.

## Decision

Extract to `packages/squad-cli/src/lib/close-match.ts` as a named export `findCloseMatch`. Both commands import and alias it as `_findCloseMatch` to minimize call-site diff noise. The export surface is minimal — one function, no dependencies.

## Rationale

- Eliminates maintenance risk from divergent edits to two copies of the same algorithm.
- `packages/squad-cli/src/lib/` is the established location for non-command utilities (compare `git-root.ts`).
- The function has no side effects and no external dependencies; extraction is safe.

## Applies to

All future commands that need callsign suggestion should import from `../lib/close-match.js` rather than implementing their own Levenshtein variant.
