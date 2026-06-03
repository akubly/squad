# 31 — Cross-repo CLI wiring fixes

## Summary

Post-implementation review of the cross-repo arc (pieces 26–30) found that several library functions shipped in `sync.ts` and `bind.ts` are not reachable from the CLI dispatch surface, and that one validation helper exists in the codebase but is not applied at the correct boundary. This piece wires the five gaps so that `squad bind` and `squad sync` behave as their piece-26/27/28 contracts specify. No public schema changes are made; the fixes restore fidelity to contracts already accepted by the team.

Stack position: Part 31 of the cross-repo transport arc. Branches off piece 30.5 (`squad/piece-30.5-scrub-gate-audit`). Depends on 30.5 — the scrub-gate rule additions from that piece must be present before this piece is committed.

## Problem

Static analysis of the shipped CLI dispatch surface identified five surfaces that are implemented as library code but are not yet reachable from, or not yet enforced at, the correct CLI boundary.

**1.** `publishTeamRootToInbox` is exported from `sync.ts` (lines 812–926) but is never called from `runSync` (lines 425–497). The CLI path for `squad sync --push` dispatches to `syncPush`, which pushes squad-state branches — not inbox branches. The piece-28 inbox publish flow is entirely unreachable through the CLI.

**2.** `runBind` builds a `SquadDirConfig` object (bind.ts lines 231–246) that does not include `stateBackend`. `detectBackend()` in sync.ts (lines 169–177) returns `null` when the field is absent. `runSync` treats a null backend as `'local'` and exits with "no remote sync needed" before executing any git operations.

Note: `runBind` does temporarily write `stateBackend: 'orphan'` to config.json at lines 272–274 during git hook installation, but immediately restores the config without the field at line 278. The field is not persisted.

**3.** `hydrateTeamRootFromStateRef` is exported from `sync.ts` (lines 708–748) but is never called from `runSync`'s pull path (lines 477–490). After `squad sync --pull`, the sidecar TEAM_ROOT working directory is not populated from the fetched state branch.

**4.** The alias resolution chain in `runSync` (lines 453–466) reads `options.developer` then `syncConfig?.developerAlias`. It does not check `process.env['SQUAD_DEVELOPER_ALIAS']`. The ADO pipeline template `publish-inbox.yml` sets that environment variable; any pipeline run that omits `--developer` fails with "developer alias required" despite the variable being present.

**5.** `runBind` accepts any string for `developerAlias` and persists it to config.json without validation. `DEVELOPER_ALIAS_RE` (`/^[a-z][a-z0-9-]{0,38}$/`) is defined in sync.ts at line 504 but is never applied at bind time. Malformed aliases persist silently and produce errors later, inside `publishTeamRootToInbox`, with no indication that the alias originated from config.json or `squad bind`.

## Proposed change

Each sub-proposal below is independently evaluable — accept, defer, or reject before implementation begins. Sub-proposal A is non-deferrable (it is the primary wiring gap; B and C both depend on it being present to be testable end-to-end).

### A. Wire `publishTeamRootToInbox` into the `runSync` push path

**Rationale:** The piece-28 inbox flow is the agreed publication contract. `syncPush` (squad-state branch push) is correct for single-repo configuration. For cross-repo configuration, `publishTeamRootToInbox` must be the push dispatch target.

**Implementation:**

In `runSync` (sync.ts), replace the unconditional `syncPush` call in the `isPush` block with a conditional:

```typescript
if (isPush) {
  const crossRepo = syncConfig?.stateRemote !== undefined &&
    config.teamRoot !== undefined;
  if (crossRepo) {
    // Cross-repo: publish a per-developer inbox branch
    const sessionId = process.env['COPILOT_SESSION_ID'] ?? crypto.randomUUID();
    const inboxBranch = computeInboxBranchName(resolvedAlias, sessionId);
    const absTeamRoot = path.resolve(repoRoot, config.teamRoot);
    await publishTeamRootToInbox(absTeamRoot, remote, inboxBranch, {
      developerAlias: resolvedAlias,
      sessionId,
      workRoot: repoRoot,
    });
  } else {
    syncPush(repoRoot, remote, backend, quiet);
  }
}
```

`config` here is the full config.json object (extend `readSyncConfig` to also read `teamRoot`, or add a parallel `readFullConfig` call). `resolvedAlias` is the alias resolved per sub-proposal D's chain.

**SessionId source:** Prefer `process.env['COPILOT_SESSION_ID']` (set by the Copilot CLI environment) as the primary source. Fall back to `crypto.randomUUID()` at sync time. Do not scan the `sessions/` directory — that introduces I/O and ordering assumptions not required by the piece-28 contract.

**Special scrutiny:** Piece-28 unit tests call `publishTeamRootToInbox` directly. That is insufficient: those tests cannot catch CLI dispatch regressions. The integration test for sub-proposal A must call `runSync` (not `publishTeamRootToInbox`) and assert that the inbox ref appears on the bare-repo fixture. The test must fail before the fix and pass after.

**Test surface:**

| File | Test name | RED → GREEN |
|---|---|---|
| `test/cli/cross-repo-sync.test.ts` | `runSync --push creates squad/inbox/<alias>/<timestamp>-<sessionId> ref on remote` | Fails before fix (ref absent); passes after |
| `test/cli/cross-repo-sync.test.ts` | `runSync --push snapshot payload matches piece-28 allowlist` | Fails before fix; passes after |
| `test/cli/cross-repo-sync.test.ts` | `runSync --push single-repo config falls back to syncPush (no inbox ref created)` | Passes before and after (regression guard) |

---

### B. Persist `stateBackend: 'orphan'` in config.json from `runBind`

**Rationale:** `detectBackend()` in `runSync` gates all remote sync operations on `config.stateBackend`. Without the field, every `squad sync` invocation on a cross-repo-bound WORK_ROOT exits immediately.

**Implementation:**

In `runBind` (bind.ts), add `stateBackend: 'orphan'` to the config object at line 231 when both `teamRepoUrl` and a resolved `stateRemote` are present:

```typescript
const config: SquadDirConfig = {
  version: 1,
  teamRoot: relativeTeamRoot,
  projectKey: null,
  stateRemote,
  stateBranch,
  inboxBranchPrefix,
  stateBackend: 'orphan',           // ← add
  ...(developerAlias !== undefined ? { developerAlias } : {}),
  // ...
};
```

Remove the temporary write/restore pattern at lines 272–278 — it is no longer needed because the field is now in the canonical config object.

**Backward-compat:** A bind without `teamRepoUrl` (single-repo path, if such a path exists) must not write `stateBackend`. The field is conditional on cross-repo wiring being present. Inspect whether `runBind` has a single-repo code path; if not, the unconditional add is safe.

**Test surface:**

| File | Test name | RED → GREEN |
|---|---|---|
| `test/cli/bind.test.ts` | `config.json after cross-repo bind contains stateBackend: 'orphan'` | Fails before fix; passes after |
| `test/cli/bind.test.ts` | `temporary write/restore of stateBackend is no longer present` | Structural assertion |
| `test/cli/sync-command.test.ts` | `runSync does not bail with 'no remote sync needed' after cross-repo bind` | Fails before fix; passes after |

---

### C. Wire `hydrateTeamRootFromStateRef` into the `runSync` pull path

**Rationale:** `syncPull` fast-forwards squad-state branches in the WORK_ROOT remote-tracking refs. It does not populate the TEAM_ROOT sidecar working directory. `hydrateTeamRootFromStateRef` is the correct next step for cross-repo configuration.

**Implementation:**

In `runSync`, after `syncPull` completes in the `isPull` block:

```typescript
if (isPull) {
  syncPull(repoRoot, remote, backend, quiet);
  const teamRootRel = config.teamRoot;
  if (teamRootRel) {
    const absTeamRoot = path.resolve(repoRoot, teamRootRel);
    await hydrateTeamRootFromStateRef(absTeamRoot, remote, stateBranch);
  }
}
```

`stateBranch` is read from `config.stateBranch ?? 'squad-state'`. Use the same `config` object introduced in sub-proposal A.

**Test surface:**

| File | Test name | RED → GREEN |
|---|---|---|
| `test/cli/cross-repo-sync.test.ts` | `runSync --pull populates TEAM_ROOT .squad/ files after fetch` | Fails before fix (sidecar empty); passes after |
| `test/cli/cross-repo-sync.test.ts` | `hydrateTeamRootFromStateRef is idempotent — second pull is a no-op` | New assertion |

---

### D. Add `SQUAD_DEVELOPER_ALIAS` env var fallback in `runSync`

**Rationale:** The ADO pipeline template (`publish-inbox.yml`) sets `SQUAD_DEVELOPER_ALIAS` in the pipeline environment. Without this fallback, pipeline runs that do not pass `--developer` fail even when the variable is set.

**Implementation:**

In `runSync` (lines 453–466), extend the alias resolution chain:

```typescript
const alias =
  options.developer !== undefined ? options.developer :
  process.env['SQUAD_DEVELOPER_ALIAS'] ??
  syncConfig?.developerAlias;
```

Resolution order: CLI flag (`--developer`) → env var (`SQUAD_DEVELOPER_ALIAS`) → persisted config (`developerAlias` in config.json) → error.

The env var is placed second (before persisted config) because it is more specific than stored state for pipeline runs, and a pipeline operator setting the variable explicitly intends it to win over any stale config value.

**Test surface:**

| File | Test name | RED → GREEN |
|---|---|---|
| `test/cli/sync-command.test.ts` | `CLI --developer flag wins over env var and config` | Regression guard |
| `test/cli/sync-command.test.ts` | `SQUAD_DEVELOPER_ALIAS env var used when --developer flag absent` | Fails before fix; passes after |
| `test/cli/sync-command.test.ts` | `config.json developerAlias used when neither flag nor env var present` | Regression guard |
| `test/cli/sync-command.test.ts` | `runSync exits with error when no alias source available` | Regression guard |

---

### E. Apply `DEVELOPER_ALIAS_RE` validation in `runBind`

**Rationale:** Validation at bind time provides early, actionable error messages. Validation deferred to `publishTeamRootToInbox` provides errors with no indication that the alias came from `squad bind`.

**Implementation:**

Export `DEVELOPER_ALIAS_RE` from sync.ts (or move it to a shared utility imported by both files). In `runBind`, before writing config.json:

```typescript
if (developerAlias !== undefined) {
  if (!DEVELOPER_ALIAS_RE.test(developerAlias)) {
    console.error(
      `squad bind: --developer-alias '${developerAlias}' is invalid.\n` +
      `  Must match ^[a-z][a-z0-9-]{0,38}$ (lowercase letters, digits, hyphens; ` +
      `starts with a letter; max 39 chars).`,
    );
    process.exit(1);
  }
}
```

The error message names `--developer-alias` — the flag as shipped in cli-entry.ts (line 1162) — not the internal `developerAlias` property name.

**Test surface:**

| File | Test name | RED → GREEN |
|---|---|---|
| `test/cli/bind.test.ts` | `runBind rejects uppercase alias with clear error` | Fails before fix (no error); passes after |
| `test/cli/bind.test.ts` | `runBind rejects underscore alias with clear error` | Fails before fix; passes after |
| `test/cli/bind.test.ts` | `runBind rejects leading-digit alias with clear error` | Fails before fix; passes after |
| `test/cli/bind.test.ts` | `runBind accepts valid lowercase-hyphen alias` | Regression guard |

---

## Special scrutiny

**SessionId source (sub-proposal A):** Prefer `COPILOT_SESSION_ID` env var as the primary source; fall back to `crypto.randomUUID()`. The sessions/ directory scan must not be used — it creates I/O coupling and ordering assumptions the piece-28 contract does not require. Document the chosen source in the commit body.

**Dead code surface (sub-proposal A):** The piece-28 unit tests call `publishTeamRootToInbox` directly. A test that calls the library function directly cannot catch CLI dispatch regressions. Sub-proposal A's mandatory test is an integration-level assertion that calls `runSync` through CLI dispatch end-to-end with a bare-repo fixture.

**Temporary write/restore removal (sub-proposal B):** The temporary `stateBackend: 'orphan'` write at bind.ts lines 272–278 was introduced as a workaround. Removing it after adding the field to the canonical config is correct. Confirm the git hook installation still works after the removal — `installGitHooks` may read `stateBackend` from the config file it was given, in which case the permanent field satisfies its read.

**Single-repo fallback guard (sub-proposal A):** `syncPush` must remain the dispatch target for single-repo configuration. The conditional in sub-proposal A's implementation must not route single-repo pushes to `publishTeamRootToInbox`. Add a regression guard test that asserts no inbox ref is created when `teamRoot` is absent from config.json.

## Test surface (consolidated)

All sub-proposals extend existing test files. No new test files are needed.

| File | Sub-proposals |
|---|---|
| `test/cli/cross-repo-sync.test.ts` | A, C |
| `test/cli/bind.test.ts` | B, E |
| `test/cli/sync-command.test.ts` | B (secondary), D |

Run the full test suite after implementing all accepted sub-proposals. Sub-proposals B–E touch wiring that other tests may depend on.

## Known divergences

The following flag-name divergences between the piece-26/27 specs and the shipped CLI surface are accepted as drift. The shipped names are now the ground truth; the piece-26/27 specs are the historical record.

| Spec name | Shipped name | Location |
|---|---|---|
| `--work-root` | Not a CLI flag (internal `workRoot` option) | sync.ts `SyncOptions` |
| `--docs-url` | Positional `<team-repo-url>` | cli-entry.ts bind handler |
| `--remote` (state remote in bind) | `--state-remote` | cli-entry.ts bind handler |
| `--developer-alias` (sync) | `--developer` | cli-entry.ts sync handler |

The env var `SQUAD_DEVELOPER_ALIAS` is not a divergence — it was specified in piece-28 and is corrected to be wired by sub-proposal D.

## Dependencies

- Piece 30.5 (chain continuity; must be present before piece 31 commits)
- Restores fidelity to piece-26/27/28 contracts; does not modify their spec'd schemas
- `SquadDirConfig` type in `@bradygaster/squad-sdk` must include `stateBackend?: string` and `teamRoot?: string` — verify these fields exist before sub-proposal B and C implementation begins
