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


### Recursion-Guard Test Standard (Piece 34 FIDO Directive)
### Bump-build must fire exactly once per build root (2026-05-28)

**Pattern:** In an npm workspaces monorepo, version bumping must happen at the root `prebuild` ONLY. The bump script must update ALL package.json files (root + each workspace) and rewrite cross-workspace pins atomically. A workspace-scoped hotfix commit that edits only ONE package.json will always drift the tree.

**Root cause of the `.10`/`.10`/`.11` drift:** Commit `0f5ac1d2` manually bumped only `packages/squad-cli/package.json` (version + sdk dep pin) to re-align with a published release, leaving root and sdk at `.10`. `scripts/bump-build.mjs` was NOT involved — Brady had `SKIP_BUILD_BUMP=1` set when he ran `npm run build`, so the script was skipped entirely. The drift was already on disk before the build ran.

**Diagnostic technique:** The `npm run build` banner line (`> @scope/pkg@version build`) captures the version from `package.json` at the moment each workspace script is about to run. If two workspaces print different version numbers in a single root build invocation, a drift commit touched fewer than all three package.json files. Find it with: `git log --oneline -- package.json packages/squad-sdk/package.json packages/squad-cli/package.json`.

**Repair rule:** Highest on disk wins — bring all lower-versioned files up to the highest; never down. Confirm with `SKIP_BUILD_BUMP=1 npm run build` (all banners must match).

### Piece 25 Rev — FIDO + CONTROL nits (2026-05-28)

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

### Scope-rename audit heuristic (2026-05-28) — @bradygaster → @wifi-aware scrub

When auditing for package scope drift after a rename, classify every hit into one of four buckets before touching anything:

1. **Real bug** — import/require paths, dedupe keys in vitest/webpack config, CLI error messages referencing the old package name, JSDoc `@deprecated` notices naming the old package. Fix all of these.
2. **Intentional alias** — deprecated re-export symbols kept for backward compat. The symbol stays; only update the JSDoc text that names the package.
3. **Docs-historical** — changelogs, orchestration logs, prior session histories, old proposals. Leave untouched; they are an accurate record.
4. **Template / GitHub handle** — `@username` in reviewer strings is a GitHub handle not a package scope. Leave untouched.

Special cases:
- **Root umbrella workspace name** (`"name": "@bradygaster/squad"` in root `package.json`) — intentionally kept if the root package is private/unpublished. Verify against the rescope commit message.
- **Bundle test assertions for root name** — tests that assert `name: '@bradygaster/squad'` on the root workspace package are correct; bulk-replace tools must target the sub-package suffixes (`/squad-sdk`, `/squad-cli`), not the bare root name.

PowerShell bulk replace: always use a specific suffix pattern (e.g. `@bradygaster/squad-sdk`) not the bare `@bradygaster` prefix, to avoid clobbering root package name or GitHub handle occurrences. After bulk replace, grep for the old pattern again to confirm zero hits in source.

### version.ts `applyVersionStamp` regex bug pattern (2026-05-28)

Narrow version regexes like `[0-9.]+(?:-[a-z]+(?:\.\d+)?)?` only handle single-segment prerelease tags (e.g. `-preview.10`). Multi-segment tags like `-mc.preview.11` are only partially matched; the leftover tail (`.preview.11`) stays in the string. Each `stampVersion` call then appends the suffix again, producing runaway duplicates.

**Fix pattern:** Use `\S+` (any non-whitespace) in place of the narrow version character class. Same fix applies to both `applyVersionStamp` and `readInstalledVersion` HTML-comment regexes in the same file.

**Detection signal:** If `.github/agents/squad.agent.md` grows a repeated `.preview.11.preview.11...` string after running `npm run build`, this is the root cause.

### npm rescope auth failure workaround — junction symlinks (2026-05-28)

After a scope rename, `npm install` will fail E401 if the new scope is hosted on an authenticated registry (e.g. Azure DevOps package feed) and credentials are not configured locally. To unblock builds and test runs:

```powershell
New-Item -ItemType Junction -Path "node_modules/@wifi-aware/squad-sdk" -Target "packages/squad-sdk"
New-Item -ItemType Junction -Path "node_modules/@wifi-aware/squad-cli" -Target "packages/squad-cli"
```

This mirrors what `npm install --workspaces` would create. The old scope junctions (if present) can remain; both resolve to the same workspace packages.

**Important:** Do NOT commit these junction entries. They are local build-environment workarounds only.

### Stale old-scope junctions survive rescope until `npm install` runs (2026-05-28)

When workspace package names are renamed, `node_modules/@old-scope/*` junction symlinks from the previous `npm install` remain on disk. Tests importing the old package name continue to pass via these stale junctions, masking the import-path bugs. The correct fix is to update all import paths to the new scope — not to rely on stale junctions.

## Archive

Older context (pieces 9–31) documented in `history-archive.md`.
