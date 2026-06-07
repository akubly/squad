# Core Dev History

> Environmental, Electrical, and Consumables Manager

## Current Status (as of 2026-06-06)

**Active Phase:** Phase B, Pieces 21-35 arc  
**Latest completion:** Piece 34 (Client-side publish triggers) — Commit `b0045b27`  
**Next piece:** Piece 35+  
**Key dependencies:** Registry-first topology (piece 32–33), cross-repo hook surface (piece 34 A)

**Core patterns maintained:**
- Registry module = schema+disk-I/O boundary; resolver logic deferred downstream
- Template sync excludes `.copilot/skills/` — manual propagation required
- Cherry-picks from insider branches require dropping insider-only module references

**Scrub-gate baseline:** Pre-existing failures acknowledged (Squad's own `/casting/`, `/identity/`, `orchestration-log` templates match strip-list pattern; accepted per decisions-archive.md)

## Summary

This history covers SDK lifecycle, registry schema, template propagation, cherry-pick rebases, and Phase B replay coordination. Core patterns: (1) Registry module as schema+disk-I/O boundary, resolver logic deferred to subsequent pieces. (2) Template sync via sync-templates.mjs covers .squad-templates/ but NOT .copilot/skills/ — manual propagation required for init-mode across packages. (3) Cherry-picks from insider branches to dev require dropping insider-only module references.

## Recent Pieces (Pieces 33-34)

### Piece 34 — Client-side publish triggers (2026-06-06) ✅

**Commit:** `763c2451` (pushed to origin)

3 sub-proposals: A (cross-repo hook + assign wiring), B (defer external Copilot CLI hook API — not found), C (--dry-run, status, .squad/.last-publish).

**Status:** All gates PASS. FIDO rejection on A3 recursion-guard test (exit-code-only assertion insufficient) resolved via sentinel-function marker-file approach. Test is now load-bearing (Case 3 proves removal breaks test). Flight gate-cleared with B-doc placement ruling: record in separate local .squad commit, not pushed product commit.

### Piece 33 — Sync-from-registry (2026-06-06) ✅

**Commit:** `0ce892e2`

4 sub-proposals: A (registry lookup, entry matching), B (cross-repo publish), C (state ref hydration), D (detection/single-repo regression guard).

**Status:** All gates PASS. detectBackend disposition documented; ESM live-binding test constraints identified; stateRemote defaulting pattern established.

### Piece 32 — Registry state fields (2026-06-05) ✅

**Amended commit:** `26c17667`

3 sub-proposals: A (RegistryEntry extension), B (assign flags + additive merge), C (DEVELOPER_ALIAS_RE validation).

**Status:** FIDO re-verified complete. All nits addressed. 27/27 tests GREEN.

## Key Learnings (Recent)

### Recursion-Guard Test Standard (Piece 34 FIDO Directive)

Sentinel-function + marker-file approach: prepend `squad()` function shadowing PATH; assert marker absence when guard fires, presence when guard absent. Three-case structure required (including guard-stripped case) to prove test load-bearing. Exit-code-only assertions insufficient.

### Injectable Seam Discipline

Pattern from piece 32 (`_writeRegistryFn`) reused in piece 34 (`_installCrossRepoHookFn`). Optional field on opts, defaults to real implementation. Allows test interception without forking runtime path.

### Git Root Validation

Use `git rev-parse --show-toplevel` + `normalisedPathKey` comparison, not `--git-dir` (which succeeds for subdirectories).

### PUBLISH_ALLOWLIST_EXACT Maintenance

Any .squad/ file traveling with inbox snapshots must be explicitly added. Missing entries cause unexpected-file errors on next sync.

### `.last-publish` Write Points

Write after cross-repo `publishTeamRootToInbox` resolve and after single-repo `syncPush` return. Best-effort (swallow errors) so cannot abort successful sync.

### Windows Shell in Spawned Tests

Use bundled Git shell via `which.sync('git')` path resolution, not PATH lookup.

## Archive

Older context (pieces 9–31) documented in `history-archive.md`.
