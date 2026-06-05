# 33 — Sync from registry

## Summary

Replace `runSync`'s reliance on `.squad/config.json` in the WORK_ROOT (which does not exist in the registry-first topology) with resolution from the registry entry introduced by piece 32. Wire the exported-but-never-invoked `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` functions into `runSync`'s push and pull paths respectively, so `squad sync --push` and `squad sync --pull` exercise the full cross-repo contract. Add `SQUAD_DEVELOPER_ALIAS` as an env-var fallback in the alias resolution chain so pipeline-equivalent and scripted invocations that do not pass `--developer` can still resolve an alias without a config.json.

Stack position: Part 33 of the cross-repo transport arc. Branches off piece 32 (`squad/piece-32-registry-state-fields`). Depends on piece 32's `stateRemote?`, `stateBranch?`, and `developerAlias?` fields on `RegistryEntry`. Foundation for pieces 34 and 35.

## Problem

`runSync` (introduced as a first-class CLI command in piece 27) resolves `teamRoot`, `stateRemote`, `stateBranch`, and `developerAlias` from `WORK_ROOT/.squad/config.json`. In the registry-first topology (constraints 2 and 3 from the cross-repo arc), product-repo clones are registered entries with a `path` field pointing at the docs-repo TEAM_ROOT; there is no product-repo `config.json` to read.

As a consequence, three shipped functions are dead code: `publishTeamRootToInbox` and `hydrateTeamRootFromStateRef` (both exported from `sync.ts`) are never called from any CLI dispatch path. `squad sync --push` dispatches to `syncPush`, which pushes squad-state branches — the correct behavior for single-repo configuration but not the cross-repo inbox publish contract from piece 28. `squad sync --pull` fetches remote-tracking refs but never populates the TEAM_ROOT sidecar working directory from the fetched state branch.

Additionally, the alias resolution chain in `runSync` does not check `process.env['SQUAD_DEVELOPER_ALIAS']`. Pipeline contexts that set this environment variable but do not pass `--developer` fail on the alias-empty guard despite the variable being present.

The fix surface is `runSync` alone: replace config.json resolution with registry lookup; conditionally dispatch to `publishTeamRootToInbox` on the push path and call `hydrateTeamRootFromStateRef` on the pull path; add the env-var fallback to the alias chain.

## Proposed change

Each sub-proposal is independently evaluable before implementation begins. Sub-proposal A is non-deferrable; B and C depend on A's registry resolution being present to be testable end-to-end.

---

### A. Replace config.json resolution with registry resolution in `runSync`

**Rationale:** The registry entry (piece 32) is the single source of truth for cross-repo state metadata. TEAM_ROOT, `stateRemote`, `stateBranch`, and `developerAlias` all live there. Reading config.json in the cross-repo topology either reads a file that does not exist (silent null) or reads a stale value that diverges from the registry.

**Resolution order for TEAM_ROOT:**

1. `process.env['SQUAD_TEAM_ROOT']` — explicit override for scripting, same semantics as the existing env var used elsewhere in the arc.
2. Registry lookup — load `~/.squad/registry.json` via `loadRegistryFromDisk()`; find the entry whose `clones[]` contains the current git root (resolved via `getRepoRoot(cwd)`); use that entry's `path` field (the docs-repo `.squad/` directory) as the TEAM_ROOT anchor. Pull `stateRemote`, `stateBranch`, and `developerAlias` from the same entry.

**Backward compatibility:** If no registry entry matches the current cwd (single-repo topology, or `squad assign` has not been run), fall back to reading `WORK_ROOT/.squad/config.json` if present. If both the registry lookup and the config.json are absent, exit 1 with a message directing the user to run `squad assign` to register the current repo.

**Registry match semantics:** Compare normalized absolute paths. Use `normalisedPathKey` (from `packages/squad-sdk/src/path-utils.ts`) for case-insensitive comparison on Windows. A clone is a match when its normalized path equals the normalized git root.

**Implementation sketch (non-normative):**

```typescript
// In runSync, replace the detectBackend + readSyncConfig block:
const gitRoot = getRepoRoot(cwd);
let teamRoot: string | undefined;
let stateRemote: string | undefined;
let stateBranch: string | undefined;
let registryAlias: string | undefined;

if (process.env['SQUAD_TEAM_ROOT']) {
  teamRoot = process.env['SQUAD_TEAM_ROOT'];
} else {
  const { registry } = loadRegistryFromDisk();
  const entry = registry?.squads.find(e =>
    e.clones?.some(c => normalisedPathKey(c) === normalisedPathKey(gitRoot))
  );
  if (entry) {
    teamRoot = path.dirname(entry.path); // entry.path ends in .squad
    stateRemote = entry.stateRemote;
    stateBranch = entry.stateBranch;
    registryAlias = entry.developerAlias;
  }
}

// Fall back to config.json for single-repo / unregistered contexts
if (!teamRoot) {
  const config = readConfigJsonIfPresent(gitRoot); // existing helper or new thin wrapper
  if (config) {
    teamRoot = config.teamRoot ? path.resolve(gitRoot, config.teamRoot) : undefined;
    stateRemote ??= config.stateRemote;
    stateBranch ??= config.stateBranch;
    registryAlias ??= config.developerAlias;
  }
}

if (!teamRoot && (direction === 'push' || direction === 'both')) {
  console.error(
    `squad sync: no registry entry found for ${gitRoot}.\n` +
    `  Run 'squad assign' to register this repo before syncing.`
  );
  process.exit(1);
}
```

`entry.path` in the registry ends in `.squad` (enforced by `validateEntry`). TEAM_ROOT is the **parent** directory — the docs-repo root — not the `.squad/` subdirectory itself.

**`detectBackend` disposition:** With config.json removed from the primary resolution path, `detectBackend()` (which reads `stateBackend` from config.json) has no input. Implementer choice: either remove the call to `detectBackend` from `runSync` and derive `backend` from registry presence (registry entry present → `'orphan'`; no entry → `null`), or remove `detectBackend` entirely if no other caller depends on it. Both are acceptable. Document the chosen disposition in the commit body.

**Acceptance criteria:**

- `runSync` does not read `WORK_ROOT/.squad/config.json` as its primary resolution source when a registry entry matches the cwd.
- `SQUAD_TEAM_ROOT` env var overrides registry lookup.
- Registry miss with no config.json fallback → clear error naming `squad assign`.
- Single-repo invocations (config.json present, no registry entry) continue to work.

---

### B. Wire `publishTeamRootToInbox` into `runSync` push path

**Rationale:** `squad sync --push` in a cross-repo context must publish a per-developer inbox branch on the docs remote — not push squad-state branches on the code remote. `publishTeamRootToInbox` is the correct dispatch target; `syncPush` is correct only for single-repo configuration.

**SessionId source:** Generate via `randomUUID()` (from `node:crypto`) at the start of `runSync` unconditionally. If `process.env['COPILOT_SESSION_ID']` is set, prefer it over the generated value (same precedence as piece 31 sub-proposal A). The `sessions/` directory must not be scanned for session IDs — that introduces I/O coupling the contract does not require.

**Implementation sketch (non-normative):**

```typescript
if (isPush) {
  const crossRepo = teamRoot !== undefined;
  if (crossRepo) {
    const sessionId = process.env['COPILOT_SESSION_ID'] ?? randomUUID();
    await publishTeamRootToInbox(teamRoot!, stateRemote ?? 'squad-docs', resolvedAlias, sessionId);
  } else {
    syncPush(gitRoot, remote, backend, quiet);
  }
}
```

`resolvedAlias` is resolved per sub-proposal D's chain. `stateRemote` defaults to `'squad-docs'` when absent from the registry entry and from config.json.

**Verify-first probe:** Before implementing, confirm `publishTeamRootToInbox` still exists as an export in `sync.ts` at approximately its expected line. Run:

```
node -e "
const s = require('fs').readFileSync('packages/squad-cli/src/cli/commands/sync.ts', 'utf8');
const line = s.split('\n').findIndex(l => l.includes('export async function publishTeamRootToInbox'));
console.log('publishTeamRootToInbox at line:', line + 1);
const rsStart = s.split('\n').findIndex(l => l.includes('export async function runSync'));
const called = s.split('\n').slice(rsStart, rsStart + 100).some(l => l.includes('publishTeamRootToInbox'));
console.log('called from runSync:', called);
"
```

Expected: line number > 0, `called from runSync: false`. If line number is 0, `publishTeamRootToInbox` has not yet been implemented — this piece depends on it being present from piece 28. STOP and confirm piece 28 is merged before proceeding.

**Acceptance criteria:**

- `runSync` with `direction: 'push'` or `'both'` and a matching registry entry calls `publishTeamRootToInbox`.
- `runSync` with `direction: 'push'` and no registry entry falls back to `syncPush`.
- SessionId sourced from `COPILOT_SESSION_ID` when set; `randomUUID()` when not.
- The inbox ref `squad/inbox/<alias>/<ts>-<sessionId>` appears on the bare-repo fixture in the integration test.

---

### C. Wire `hydrateTeamRootFromStateRef` into `runSync` pull path

**Rationale:** `syncPull` fast-forwards squad-state remote-tracking refs in the WORK_ROOT. It does not populate the TEAM_ROOT sidecar working directory. `hydrateTeamRootFromStateRef` is the correct next step for cross-repo configuration — it reads the fetched state branch and writes the TEAM_ROOT projection.

**Implementation sketch (non-normative):**

```typescript
if (isPull) {
  syncPull(gitRoot, remote, backend, quiet);
  if (teamRoot) {
    await hydrateTeamRootFromStateRef(
      teamRoot,
      stateRemote ?? 'squad-docs',
      stateBranch ?? 'squad-state',
    );
  }
}
```

**Verify-first probe:** Before implementing, confirm `hydrateTeamRootFromStateRef` still exists as an export in `sync.ts`:

```
node -e "
const s = require('fs').readFileSync('packages/squad-cli/src/cli/commands/sync.ts', 'utf8');
const line = s.split('\n').findIndex(l => l.includes('export async function hydrateTeamRootFromStateRef'));
console.log('hydrateTeamRootFromStateRef at line:', line + 1);
const rsStart = s.split('\n').findIndex(l => l.includes('export async function runSync'));
const called = s.split('\n').slice(rsStart, rsStart + 100).some(l => l.includes('hydrateTeamRootFromStateRef'));
console.log('called from runSync:', called);
"
```

Expected: line number > 0, `called from runSync: false`.

**`stateBranch` default:** Use `stateBranch ?? 'squad-state'`. Single-repo pull behavior is unchanged; hydration is only attempted when `teamRoot` is present.

**Acceptance criteria:**

- `runSync` with `direction: 'pull'` or `'both'` and a matching registry entry calls `hydrateTeamRootFromStateRef`.
- `stateBranch` defaults to `'squad-state'` when absent from the registry entry.
- `hydrateTeamRootFromStateRef` is idempotent on repeated pulls.
- Single-repo pull behavior is unchanged (no sidecar hydration attempted when `teamRoot` is absent).

---

### D. Add `SQUAD_DEVELOPER_ALIAS` env-var fallback to the alias resolution chain

**Rationale:** Pipeline templates (e.g., `publish-inbox.yml` from piece 30) set `SQUAD_DEVELOPER_ALIAS` in the pipeline environment. Without this fallback, pipeline invocations that do not pass `--developer` fail on the alias-empty guard even when the variable is set.

**Resolution order:**

1. `options.developer` (CLI `--developer` flag) — most explicit.
2. `process.env['SQUAD_DEVELOPER_ALIAS']` — pipeline/scripting override, more specific than persisted state for ephemeral invocations.
3. `registryAlias` (the `developerAlias` field from the matching registry entry, as resolved in sub-proposal A) — persisted default.
4. Error — exit 1 with message naming the missing alias and pointing to `squad assign --developer-alias <alias>`.

**Implementation sketch (non-normative):**

```typescript
const resolvedAlias =
  options.developer !== undefined ? options.developer :
  process.env['SQUAD_DEVELOPER_ALIAS'] ??
  registryAlias;

if (!resolvedAlias && isPush) {
  console.error(
    `squad sync: developer alias is required for --push.\n` +
    `  Pass --developer <alias>, set SQUAD_DEVELOPER_ALIAS, or run ` +
    `'squad assign --developer-alias <alias>' to persist the alias.`
  );
  process.exit(1);
}
```

**Env var name:** Exactly `SQUAD_DEVELOPER_ALIAS` — matches the name specified in piece 28 and the ADO pipeline template.

**Acceptance criteria:**

- `--developer` flag wins over env var and registry alias.
- `SQUAD_DEVELOPER_ALIAS` env var used when `--developer` is absent.
- Registry `developerAlias` used when neither flag nor env var is present.
- Missing alias on `--push` exits 1 with a message referencing `squad assign`.

---

## Special scrutiny

**No config.json as primary source:** After piece 33, `runSync` must not read `WORK_ROOT/.squad/config.json` as the primary source of `teamRoot`, `stateRemote`, `stateBranch`, or `developerAlias` when a registry entry matches the current cwd. Config.json is a valid fallback for single-repo / unregistered contexts only. If an implementer finds that config.json reads are unconditionally present in `runSync`, that is a defect.

**TEAM_ROOT is the docs-repo root.** `entry.path` in the registry ends in `.squad`. TEAM_ROOT is `path.dirname(entry.path)` — the directory that contains `.squad/`, not the `.squad/` directory itself. Passing `.squad/` as TEAM_ROOT to `publishTeamRootToInbox` or `hydrateTeamRootFromStateRef` is a defect.

**Dead code path (publishTeamRootToInbox and hydrateTeamRootFromStateRef):** Both functions were exported but never invoked from `runSync` prior to this piece. The integration tests for sub-proposals B and C must call `runSync` through CLI dispatch — not the library functions directly — to prove that the wiring is in place. A test calling `publishTeamRootToInbox` directly cannot catch CLI dispatch regressions.

**`detectBackend` disposition:** The implementer must document which option was chosen (call removed vs. function removed) in the commit body. If `detectBackend` is removed entirely, check for any remaining callers outside `runSync` before deletion.

**Single-repo regression guard:** `syncPush` must remain the dispatch target when `teamRoot` is absent. The conditional in sub-proposal B must not route single-repo pushes to `publishTeamRootToInbox`. A regression guard test must assert no inbox ref is created when no registry entry matches cwd.

**Blast radius:** Sub-proposals A–D all touch `runSync`. The full test suite (`npm test`) must be run after implementing all accepted sub-proposals, not just the touched test files. Alias resolution and remote resolution changes have wide impact on existing sync tests from piece 27.

## Test surface

TDD: write tests to RED before implementation; verify GREEN after.

| Test file | Assertions |
|---|---|
| `test/cli/sync-command.test.ts` (extend) | Alias resolution: `--developer` wins over env var and registry; `SQUAD_DEVELOPER_ALIAS` wins absent flag; registry `developerAlias` wins absent flag and env; exit 1 when no alias and `--push`. Remote/TEAM_ROOT resolution: registry entry match → teamRoot from `path.dirname(entry.path)`; `SQUAD_TEAM_ROOT` env var overrides registry; no match + no config.json → exit 1 naming `squad assign`. |
| `test/cli/sync-registry-resolution.test.ts` (new) | TEAM_ROOT resolves to `path.dirname(entry.path)` for a matching clone; `stateRemote` / `stateBranch` / `developerAlias` pulled from same entry; cwd with no registry match → exit 1; `SQUAD_TEAM_ROOT` override bypasses registry lookup; two registry entries — only the matching clone's entry is used. |
| `test/cli/cross-repo-sync.test.ts` (extend or new) | Integration test using bare-repo fixture: `squad sync --push` with matching registry entry creates `squad/inbox/<alias>/<ts>-<sessionId>` ref on the bare remote; `squad sync --pull` calls `hydrateTeamRootFromStateRef` and populates TEAM_ROOT sidecar; `squad sync --push` with no registry entry falls back to `syncPush` (no inbox ref created — regression guard); `hydrateTeamRootFromStateRef` is idempotent on repeated pulls. |

## Files

| Path | Role |
|---|---|
| `packages/squad-cli/src/cli/commands/sync.ts` | Sub-proposals A–D: replace config.json resolution with registry resolution; wire push and pull paths; add env-var alias fallback |
| `test/cli/sync-command.test.ts` | Extend: alias resolution chain tests; TEAM_ROOT resolution tests |
| `test/cli/sync-registry-resolution.test.ts` | New: registry match, miss, override tests |
| `test/cli/cross-repo-sync.test.ts` | Extend or new: integration tests using bare-repo fixture |
| `.changeset/sync-from-registry.md` | patch changeset for `squad-cli` |

## Dependencies

- Branches off piece 32 (`squad/piece-32-registry-state-fields`)
- Requires piece 28 (`publishTeamRootToInbox` export in `sync.ts`) and a pull-path hydration export (piece 31 sub-proposal C or equivalent) to be present before implementation
- Foundation for pieces 34 and 35

## Notes

`normalisedPathKey` from `packages/squad-sdk/src/path-utils.ts` is the correct comparison utility for registry clone path matching. Do not reimplement case-insensitive path comparison inline.

The `loadRegistryFromDisk()` function in `packages/squad-sdk/src/registry.ts` handles the registry file path resolution and parsing. Import it rather than reading the registry file directly.

Rollback is a single-piece revert. Developers who have not run `squad assign` are unaffected — the config.json fallback preserves their current behavior.
