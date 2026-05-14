### 2026-05-14T14:38:40.349-07:00: Piece 08a revision — CAPCOM (post-rejection)
**By:** CAPCOM (SDK Expert) — reviewer rejection lockout, independent revision
**Branch:** akubly/upstream-08a-migrate-readonly-commands @ 0e4f301e
**Original author locked out:** CONTROL
**Findings addressed:**
- CAPCOM: SDK barrel routing — added an overload-compatible registry-aware `resolveSquad` path through `packages/squad-sdk/src/index.ts` and rerouted CLI resolver imports to the SDK root barrel.
- CAPCOM: dispatch unification — migrated `delegate` to the same v2 resolution path used by `discover`, with shared start-directory handling.
- FIDO: --team-root / SQUAD_TEAM_ROOT parity — threaded CLI start-dir resolution into cross-squad commands and added coverage for both override mechanisms.
- FIDO: action-command boundary test — strengthened coverage so `consult --status` proves action commands still use legacy start-directory dispatch outside the read-only migration.
**Test result:** 8/8 migration tests pass; full suite 216/225 files pass, 6308/6432 tests pass.
**Scrub gate:** Gates 2/4/5/6 PASS; Gates 1/3 baseline (no new piece-08a strip-listed path contamination).
