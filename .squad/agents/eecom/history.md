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

### Piece 40 — Callsign-namespaced transport (2026-06-11) ✅

**Branch:** `squad/piece-40-callsign-namespaced-transport`

Sub-proposals A–D implemented (E deferred per triage):
- **A:** `publishTeamRootToInbox` gains optional `callsign?` 5th param; 3-component branch `squad/inbox/<callsign>/<handle>/<ts>-<seq>-<sessionId>` when callsign present; 2-component preserved for single-repo mode; cross-repo push without callsign is a fatal error directing user to `squad assign --callsign`; `publish-metadata.json` gains `callsign` field.
- **B:** `runInit` sets `stateBranch: 'squad/state/<callsign>'` when callsign provided; omits field otherwise; sync pull reads `entry.stateBranch` (unchanged, fallback `squad-state` still works).
- **C:** `installFoldPipeline` gains `callsign?` option; validates with `CALLSIGN_RE`; applies string-replacement parameterization at generation time (templates unchanged on disk); no-callsign = byte-identical output.
- **D:** Tests only. All 4 guard behaviors confirmed correct (D1 warn+succeed, D2 error, D3 --callsign excludes, D4 Guard 7).

**Tests:** 22/22 GREEN. Regressions in `cross-repo-sync.test.ts` (B1, B3) fixed by adding `callsign` to registry entries and updating branch assertions.

**Changeset:** `.changeset/callsign-namespaced-transport.md` (patch for `@bradygaster/squad-cli`).

**Pre-existing failures acknowledged:** `assign.test.ts` P34.A1 and P34.A3 were already failing before piece 40 — the piece-36 decision to install hooks in both clones superseded piece-34 host-only behavior, but those older tests were not updated. Not caused by piece-40 changes.



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

### Callsign-namespaced transport (Piece 40)

**`CALLSIGN_RE`:** `/^[a-z][a-z0-9-]{1,38}$/` — identical to `INBOX_HANDLE_RE`. Lowercase-only, starts with letter, hyphens allowed, 2–39 chars total. Exported from `packages/squad-sdk/src/validation.ts`.

**Callsign threading through publish:**
1. Captured in `runSync` at registry match: `registryCallsign = entry.callsign`
2. Cross-repo push guard: if `!registryCallsign`, `console.error(...)` + `process.exit(1)` with message directing user to `squad assign --callsign`
3. Passed to `publishTeamRootToInbox(teamRoot, remote, handle, sessionId, callsign?)`
4. Branch: `squad/inbox/${callsign}/${inboxHandle}/${ts}-${seq}-${sessionId}` (3-component when callsign set, 2-component without)
5. Metadata: `{ callsign, inboxHandle, ... }` in `.squad/publish-metadata.json`

**Template parameterization approach (C):** Read raw template, apply string-replace at generation time. Templates on disk remain unchanged (ensuring byte-identical output when `--callsign` absent).
- GitHub replacements: `'squad/inbox/**'` → `'squad/inbox/<callsign>/**'`; `squad-state` refs → `squad/state/<callsign>`
- ADO replacements: `refs/heads/squad/inbox/*` → `refs/heads/squad/inbox/<callsign>/*`; same state branch

**Test mock architecture for `runInit`:** `@bradygaster/squad-sdk/registry` mock must use `importActual` to preserve `upsertEntry` (re-exported from `./registry.js` via the barrel). Replacing the whole module loses `upsertEntry`. Pattern:
```typescript
vi.mock('@bradygaster/squad-sdk/registry', async (importActual) => {
  const actual = await importActual<...>();
  return { ...actual, loadRegistryFromDisk: vi.fn(), writeRegistry: vi.fn() };
});
```
To assert on `runInit` registry writes, check `vi.mocked(writeRegistry).mock.calls` — don't read from disk (mock makes writes a no-op).



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
