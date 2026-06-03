# Decision: Piece 31 spec staged on akubly/upstream-specs

**Date:** 2026-06-03  
**Author:** Procedures  
**Status:** Recorded

## What happened

The piece 31 spec (`31-cross-repo-cli-wiring-fixes.md`) is now present on `akubly/upstream-specs` at `docs/proposals/upstream-bradygaster/31-cross-repo-cli-wiring-fixes.md`.

Phase B replay for piece 31 is unblocked.

## Path taken

The `akubly/upstream-specs` branch had a prior commit (`80cdcfc0`) at the spec path, staged by an earlier session. That spec was structurally complete but missing two Phase B contract requirements:

1. A standalone verify-first probe block matching the Phase B handoff.
2. Explicit acceptance criteria subsections per sub-proposal (A–E).

A worktree at `../squad-replay-specs` was used to inspect and amend the spec. The amendment was committed as a forward-only addition (`f76800f1`) and pushed to `origin/akubly/upstream-specs`.

Final commit SHA: `f76800f1`

## Phase B readiness

The spec at `akubly/upstream-specs:docs/proposals/upstream-bradygaster/31-cross-repo-cli-wiring-fixes.md` now contains:

- Problem statement for all five wiring gaps
- Verify-first probe block (matching the Phase B handoff contract)
- Sub-proposals A–E with rationale, code anchors (real line numbers from sync.ts and bind.ts), test plans, and acceptance criteria
- Special scrutiny for session ID sourcing, dead-code surface, workaround removal, and single-repo fallback guard
- Consolidated test surface table (no new test files)
- Known divergences between spec surface and shipped CLI flag names
- Dependencies on pieces 26–30 and 30.5

Sub-proposal A is S0 — non-deferrable. Phase B triage on A is accept-only.
