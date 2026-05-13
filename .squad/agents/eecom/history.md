# EECOM

> Environmental, Electrical, and Consumables Manager

## Summary

EECOM owns SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

📌 **Team update (2026-05-13T17:51:48Z — Phase B Piece 04 Complete):** CONTROL completed piece 04 (path-utils module). Path-utils centralized as single source of truth for OS-aware path comparison logic. All 137 targeted tests GREEN. Decision merged to decisions.md. Future pieces (init fail-fast, assign, unassign, doctor) import from centralized path-utils module.

## Learnings

### Piece 04 revision — cross-case dedup test and S14b mechanical swap (2026-05-13)

The revision added S9b, the cross-case duplicate-path integration test, and swapped S14b from `registerEntry` to `upsertEntry`.

**S9b** (`rejects registry with case-variant duplicate paths on win32/darwin`): The registry's `normalisedPathKey` already lowercased paths on win32/darwin via `normCase`, so the implementation was correct. S9b went GREEN immediately with no impl change required. The test constructs two entries using `dir.toLowerCase()` and `dir.toUpperCase()` as the directory segment (keeping `alpha.squad` filename lowercase to satisfy the `.endsWith('.squad')` validation), then branches on `process.platform`: win32/darwin assert `toThrow(/duplicate.*path/i)`, linux asserts `not.toThrow()` (case-distinct paths are valid there). This is the canonical pattern for OS-aware registry path equality integration tests.

**S14b** (`warns when path does not exist at write-preparation time`): Pure mechanical swap — `registerEntry` → `upsertEntry`, label updated from "at register time" to "at write-preparation time" to match the surrounding vocabulary in the `upsertEntry()` describe block. No implementation change needed.

**Sanity sweep**: `registerEntry` appears in source at `registry.ts` (deprecated alias definition) and `index.ts` (re-export). In tests: the import line and `BC.1`. After the S14b fix, no internal non-BC test calls `registerEntry`. Zero additional fixes required.

**Commit structure**: impl commit amended to `c971b743`, Scribe housekeeping cherry-picked to `2a444c91`. Branch force-pushed with `--force-with-lease`.

### Adversarial review follow-up — piece 03 test hardening (2026-05-13)

Test patterns learned from piece 03 review: tautology tests pass regardless of behavior; real assertions required on platform branches. Empty array vs missing field are structurally distinct. Chain precedence tests need active git teardown. Fixture isolation in TMP requires .git marker inside TMP to avoid walking up to outer git root.

### Registry schema validator (2026-05-12)

SquadError lives in adapter/errors.ts. Registry validation uses ERROR severity + VALIDATION category. No exported path-key helper in SDK source. Tests import TypeScript via .js specifiers using project-local scratch dirs.

## Archive

Older learnings (prior to 2026-04-12) have been archived to history-archive.md for reference. See that file for Q1 2026 and earlier context including template sync patterns, cherry-pick conflicts, and loop command refactors.
