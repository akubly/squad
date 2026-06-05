# 32 — Registry state fields

## Summary

Extend the squad registry entry with three optional fields that carry per-squad cross-repo state metadata: `stateRemote` (git remote name pointing to the state-host's remote), `stateBranch` (orphan branch holding folded canonical state), and `developerAlias` (per-developer namespace identifier for inbox branch namespacing). Extend `squad assign` to accept `--state-remote`, `--state-branch`, and `--developer-alias` flags and persist them on the registry entry. This piece is purely additive — the `[key: string]: unknown` extension slot already present at line 17 of `RegistryEntry` means no migration is required and existing registry entries continue to work unchanged.

Stack position: Part 32. Branches off piece 25.5 (`squad/piece-25.5-doctor-cleanup-test-regression-repair`). Foundation piece for the new cross-repo arc (pieces 33, 34, 35).

## Problem

Cross-repo squad workflows need to identify three things beyond what the current registry carries:

1. **Which git remote to target for state operations.** The registry currently holds `path`, `origins`, `clones`, `callsign`, and `stateBackend`. None of these identify the *remote name* inside the docs-repo clone that points to the docs-repo's upstream. Without `stateRemote`, every `squad sync` invocation would require a `--state-remote` CLI flag or an environment variable.

2. **Which branch on that remote holds canonical state.** The orphan branch that stores folded squad state is configurable per deployment. Without `stateBranch`, the same flag-or-env-var problem applies to branch targeting.

3. **Who is publishing.** Developer alias is the per-developer namespace identifier used for inbox branch naming (`squad/inbox/<alias>/…`). Without `developerAlias` persisted in the registry, sync operations cannot resolve the correct inbox branch without an interactive prompt or additional flag.

The current registry surface is sufficient for discovering and binding squads. It is insufficient for executing any sync operation autonomously. Persisting these three fields at `squad assign` time eliminates the per-invocation flag burden for all downstream pieces.

## Proposed change

### A — Extend `RegistryEntry` in `packages/squad-sdk/src/registry.ts`

Add three optional fields to the `RegistryEntry` interface (lines 9–18):

```typescript
export interface RegistryEntry {
  callsign?: string;
  path: string;
  origins?: string[];
  clones?: string[];
  status?: 'active' | 'inactive';
  initUri?: string;
  stateBackend?: 'worktree' | 'local' | 'external';
  stateRemote?: string;    // git remote name; default 'origin' when absent
  stateBranch?: string;    // orphan branch name; default 'squad-state' when absent
  developerAlias?: string; // developer namespace identifier for inbox branches
  [key: string]: unknown;
}
```

**No migration required.** The `[key: string]: unknown` index signature at line 17 already allows extra fields to round-trip through the registry without data loss. Existing entries without these fields will have `undefined` values; all downstream consumers must handle `undefined` and fall back to defaults (`'origin'` for `stateRemote`, `'squad-state'` for `stateBranch`).

**No `[key: string]: unknown` removal.** The slot is retained — it exists precisely for this kind of non-breaking additive extension. Piece 32 adds three named fields from that space, but does not remove the index signature.

### B — Extend `squad assign` CLI in `packages/squad-cli/src/commands/assign.ts`

**New flags:**

| Flag | Type | Default | Persisted field |
|------|------|---------|----------------|
| `--state-remote <name>` | `string` | `'origin'` | `stateRemote` |
| `--state-branch <name>` | `string` | `'squad-state'` | `stateBranch` |
| `--developer-alias <alias>` | `string` | *(none — omitted from entry when not supplied)* | `developerAlias` |

**`SquadAssignOpts` additions:**

```typescript
export interface SquadAssignOpts {
  // … existing fields …
  stateRemote?: string;
  stateBranch?: string;
  developerAlias?: string;
}
```

**Persistence:** Both the warm path (callsign lookup, `runAssignToCopilot`) and the cold-start path (`_coldStart`) write a `RegistryEntry`. Both paths must be updated to carry the three new fields through to the `writeRegistry` / `writeRegistryFn` call. When a flag is omitted, omit the field entirely from the entry (do not write `undefined` explicitly; leave it absent so existing-entry round-trips are clean).

Apply the same additive merge discipline already used for `clones` and `origins`: if the entry already has a `stateRemote` / `stateBranch` / `developerAlias` value and the incoming call does not supply the flag, preserve the existing value. This prevents a re-assign (e.g., to pick up a new clone path) from silently erasing previously persisted metadata.

**Existing behavior unchanged.** Clone path registration, origins deduplication, Copilot payload installation, and coordinator agent installation are unaffected. The new flags are purely additive metadata.

### C — Validate `developerAlias` at assign time

Before persisting `developerAlias`, validate it against `DEVELOPER_ALIAS_RE`.

**Regex:** `/^[a-z][a-z0-9-]{1,38}$/`

This regex is currently defined in both template SKILL.md files (`packages/squad-sdk/templates/skills/publish-flow-validation-gate/SKILL.md:46` and `packages/squad-cli/templates/skills/publish-flow-validation-gate/SKILL.md:46`) but is not exported from any source module.

**Required:** Extract `DEVELOPER_ALIAS_RE` as a named export from a stable shared location — `packages/squad-sdk/src/validation.ts` (create if absent) or co-locate in `packages/squad-sdk/src/registry.ts`. The chosen location must be importable from `packages/squad-cli/src/commands/assign.ts` without circular dependency.

**Validation site:** `runAssign` (and the warm-path helper), before any registry read/write. If `opts.developerAlias` is supplied and does not match `DEVELOPER_ALIAS_RE`, throw a `SquadAssignError` with code `INVALID_ALIAS` and a message of the form:

```
Invalid --developer-alias "<value>": must match /^[a-z][a-z0-9-]{1,38}$/ (lowercase, starts with a letter, hyphens allowed, max 39 chars).
```

Fail fast — do not proceed to registry read.

## Special scrutiny

### GitHub AND ADO compatibility

`stateRemote` is a **git remote name** (a string like `origin`, `upstream`, `squad-docs`). It is not a URL. The platform (GitHub or ADO) is determined by the underlying URL that git remote resolves to, via `normalizeRemoteUrl` in `packages/squad-sdk/src/platform/detect.ts` — already shipped. Piece 32 does not inspect or parse the remote URL; it stores and retrieves the name. Platform-specific behavior is a concern for piece 33 (sync operations), not piece 32.

### No `.gitignore` or `.git/info/exclude` writes

Adam's deployer constraint 2 prohibits any modifications to `.gitignore` or `.git/info/exclude`. Piece 32 writes only to `~/.squad/registry.json`. No file-system changes outside the registry.

### No product-repo modifications

Adam's deployer constraint 3 prohibits writing any files into the product repository. `squad assign` already installs the coordinator agent at `~/.copilot/agents/squad.agent.md` (user-scoped, per constraint 5). Piece 32 does not change that installation path or add new product-repo writes.

### Backward compatibility

All three new fields are optional. Code reading `stateRemote` or `stateBranch` from a registry entry **must** handle `undefined` and fall back:

```typescript
const remote = entry.stateRemote ?? 'origin';
const branch = entry.stateBranch ?? 'squad-state';
```

`developerAlias` has no universal default — consumers that require it must check for its presence and surface a clear error or prompt when absent. This is a responsibility of pieces 33/34, not piece 32.

## Test surface

### `test/cli/assign.test.ts` (extend)

- `--state-remote` flag is accepted and persisted on the registry entry (warm path).
- `--state-branch` flag is accepted and persisted on the registry entry (warm path).
- `--developer-alias` flag is accepted and persisted on the registry entry (warm path).
- Same three flags accepted and persisted on cold-start path (`--clone-to`).
- When flags are omitted, `stateRemote` and `stateBranch` are absent from the written entry (not `undefined`-persisted), and downstream reads fall back to defaults.
- Re-assign without `--state-remote` flag preserves the existing `stateRemote` value on the entry.
- `--developer-alias` with a value failing `DEVELOPER_ALIAS_RE` (e.g., `"--bad"`, `"BAD"`, `"a".repeat(40)`) throws `SquadAssignError` with code `INVALID_ALIAS` before any registry read.
- `--developer-alias` with a valid value (e.g., `"dev1"`, `"alice-2"`) passes validation and persists.

### `test/registry.test.ts` (extend or new)

- `RegistryEntry` interface accepts all three new optional fields.
- An entry with all three fields serializes to JSON and round-trips through `loadRegistryFromDisk` / `writeRegistry` without data loss.
- An entry without the three new fields (legacy shape) loads cleanly — no type error, no missing-field error, all three field reads return `undefined`.

### `test/sdk/validation.test.ts` (new, if `validation.ts` is created)

- `DEVELOPER_ALIAS_RE` matches valid aliases (`dev1`, `alice-2`, `a1`, `a` + `b`.repeat(38)).
- `DEVELOPER_ALIAS_RE` rejects invalid aliases (`""`, `"1abc"`, `"ABC"`, `"-abc"`, `"a".repeat(40)`, `"abc_def"`).

## Files

| Path | Role |
|------|------|
| `packages/squad-sdk/src/registry.ts` | Sub-proposal A: add three optional fields to `RegistryEntry` |
| `packages/squad-sdk/src/validation.ts` | Sub-proposal C: extract and export `DEVELOPER_ALIAS_RE` (create if absent) |
| `packages/squad-cli/src/commands/assign.ts` | Sub-proposals B + C: new flags on `SquadAssignOpts`, persistence in warm + cold paths, validation call |
| `test/cli/assign.test.ts` | Test surface for sub-proposals B + C |
| `test/registry.test.ts` | Test surface for sub-proposal A |
| `test/sdk/validation.test.ts` | Test surface for sub-proposal C (if `validation.ts` is created) |

## Changeset

Required. Sub-proposals A and C touch `packages/squad-sdk/src/`; sub-proposals B and C touch `packages/squad-cli/src/`. Run `npx changeset add` and select `patch` for each affected package (`@bradygaster/squad-sdk`, `@bradygaster/squad-cli`).

## Dependencies

- Branches off piece 25.5 (`squad/piece-25.5-doctor-cleanup-test-regression-repair`).
- Foundation for pieces 33 (sync command), 34 (coordinator protocol), 35 (CLI wiring fixes).
- No dependency on pieces 26–31 (archived under `archive/pieces-26-30-dead`).
