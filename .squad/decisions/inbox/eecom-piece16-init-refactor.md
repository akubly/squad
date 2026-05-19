# Decision: Piece 16 — scaffold-state behavior change and reactivation result shape

**Date:** 2026-05-18  
**Piece:** 16 — squad init refactor  

## Topics

### 1. Scaffold-state detection: no longer throws for existing `.squad/` directories

**Decision:** `resolveScaffoldState` returns `'present'` (no throw) when `.squad/` exists and contains sentinel files. `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` is only raised for **symbolic links**. Existing directories with sentinel files proceed to registration logic.

**Rationale:** The spec (piece 16) requires "registering an existing scaffold" and "idempotent registration" as first-class flows. The prior throw-on-existing behavior blocked both. Symlinks remain rejected because writing through a symlink is a dangerous side-channel with no valid recovery path.

**Impact:** Guard-order tests in `test/cli/init-scope.test.ts` that expected `ERR_SQUAD_INIT_EXISTING_SCAFFOLD` when scaffold + callsign conflict were both present now expect `ERR_SQUAD_INIT_CALLSIGN_EXISTS`. The scaffold-state check is no longer the first guard in the conflict chain; registry guards run first.

### 2. Reactivation result shape

**Decision:** `runInit` returns `{ reactivated: { callsign, path } }` for both:
- Inactive-at-same-path (writes `status: 'active'` to registry), and  
- Active-at-same-path (idempotent, no write).

Callers that need to distinguish the two cases can check whether the registry file changed — the result shape intentionally does not expose this. Both cases represent "this squad is now registered and active."

**Rationale:** Simplicity. Callers (CLI, tests) only need to know the final state, not whether a write occurred. The spread `{ ...entry, status: 'active' }` pattern ensures unknown future fields are preserved across reactivation round-trips.
