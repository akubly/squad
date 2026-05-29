# Pre-existing build and scrub-gate baseline — piece 27

**Date:** 2026-05-29T16:30:14.652-07:00
**Author:** EECOM
**Piece:** 27 — explicit sync command

## Build failure baseline

`npm run build` was failing BEFORE piece 27 changes on branch `squad/piece-26-cross-repo-bind-config` (the piece-26 tip). Confirmed by stashing piece-27 changes and running `npm run build` — same errors produced.

Failing files (all pre-existing, not touched in piece 27):
- `packages/squad-cli/src/commands/doctor.ts` — imports missing SDK exports (`clonesMatch`, `isValidCallsign`, `normalisedPathKey`, `normalizeRemoteUrl`)
- `packages/squad-cli/src/commands/init.ts` — imports missing SDK exports
- `packages/squad-cli/src/commands/unassign.ts` — imports missing SDK exports

Root cause: SDK refactor in an earlier piece removed or renamed these exports. CLI commands referencing them were not updated. This is a separate work item and not within piece 27 scope.

**Action:** Flight or the next scheduled piece should reconcile CLI commands against current SDK exports. No piece-27 files introduce new TypeScript errors (confirmed via targeted `tsc --noEmit` check).

## Scrub-gate Gate 1 baseline

Scrub gate exits 1 due to pre-existing strip-listed paths:
- `docs/_internal/` directory (16 files)
- `templates/casting/`, `templates/identity/`, `templates/orchestration-log.md`
- `packages/squad-cli/templates/` and `packages/squad-sdk/templates/` equivalents
- `packages/squad-sdk/src/casting/`

These paths have been present since before piece 08a. Per piece-08a coordinator decision: "Scrub gate failures are pre-existing upstream baseline contamination, not piece responsibility." The strip-list was designed to exclude MS-internal Windows wireless team artifacts; Squad's own product directories (`/casting/`, `/identity/`, `orchestration-log`) match the pattern incidentally. Piece 27 introduces zero new strip-listed paths.

Gate 2 (wifi-aware): PASS
Gate 3 (akubly mentions): WARN — `.squad/` state files only, expected
Gate 4 (internal mentions): WARN — `.squad/` state files only, expected
Gate 5 (ADO fixtures): PASS
Gate 6 (file count): PASS (13 files)

## Wiring test pre-existing failures

Two wiring test failures pre-date piece 27:
- `commands/doctor-types.ts is imported in cli-entry.ts` — FAIL (pre-existing)
- `commands/init-remote.ts is imported in cli-entry.ts` — FAIL (pre-existing)

These are not piece 27 responsibility. `sync` now passes the wiring test (wire added in piece 27).
