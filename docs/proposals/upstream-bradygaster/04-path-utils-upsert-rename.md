# 04 — Path-utils extraction + `upsertEntry` rename

## Summary

This piece extracts shared path-comparison behavior into a dedicated SDK module and renames the registry write helper from `registerEntry` to `upsertEntry`. The change prepares later CLI command work by giving registry, resolver, and command code one canonical place for OS-aware path equality and clone containment checks. It is a refactor-only piece: resolver behavior, registry JSON shape, and command behavior remain the same except for the new helper name and exported path utility module.

## Context

Pieces 01 through 03 establish registry validation and registry-backed squad resolution. After those pieces, path comparison is needed in more than one layer:

- `packages/squad-sdk/src/registry.ts` needs path-key normalization when validating duplicate registry paths.
- `packages/squad-sdk/src/resolution-v2.ts` needs clone-root and subdirectory matching for registry `clones[]` resolution.
- CLI command implementations need the same equality rules for assign, unassign, init, and doctor checks.

Keeping those helpers inside the resolver makes registry and command code either duplicate the rules or depend on the resolver for non-resolution concerns. This piece extracts the helpers into a dependency-free `path-utils` module so lower-level registry code and higher-level command code can share one implementation.

## Scope and files


In scope:

- Add `packages/squad-sdk/src/path-utils.ts`.
- Add a package subpath export for `./path-utils` in `packages/squad-sdk/package.json`.
- Export path helper APIs from SDK entry points where existing consumers need them.
- Move clone path containment logic out of `resolution-v2.ts` and import it from `path-utils.ts`.
- Keep a `clonesMatch` re-export from `resolution-v2.ts` for compatibility with resolver consumers.
- Rename the registry helper API from `registerEntry` to `upsertEntry` across SDK and CLI call sites.
- Update tests in the same commit as the API rename.
- Add or update a changeset for SDK and CLI package changes.

Out of scope:

- Changing the registry file format.
- Changing resolver priority order.
- Changing remote URL normalization placement.
- Adding new CLI commands.
- Migrating existing user registry files.

## Proposal

### Mechanism

This piece extracts path helpers first, then updates registry API naming.

#### Path utility extraction

Create `packages/squad-sdk/src/path-utils.ts` with pure path helpers and no imports from registry or resolver modules. The module owns these exports:

| Export | Purpose |
| --- | --- |
| `normalisedPathKey(path: string): string` | Produces the duplicate-detection key used for registry path uniqueness. It resolves the path and applies OS-aware casing rules. |
| `pathsRefSameLocation(a: string, b: string): boolean` | Returns true when two paths refer to the same filesystem location using literal equality and realpath fallback. It must not throw when realpath is unavailable. |
| `clonesMatch(cwd: string, clone: string): boolean` | Returns true when `cwd` is the clone root or is under the clone root, using sentinel-bound prefix matching so sibling names do not collide. |

OS casing behavior is part of the contract:

- Windows and macOS compare paths case-insensitively.
- Linux compares paths case-sensitively.
- Path storage remains literal; helpers are comparison-only and must not rewrite registry entries.

`clonesMatch` must use sentinel-bound containment. For example, a clone root ending in `repo` must match `repo\subdir`, but must not match sibling paths such as `repo-tools`. Exact equality delegates to `pathsRefSameLocation`; containment checks should use literal comparison first and realpath fallback only when available.

`resolution-v2.ts` imports `clonesMatch` from `path-utils.ts` and re-exports it. This preserves existing resolver import shape while making `path-utils.ts` the canonical implementation. `registry.ts` imports `normalisedPathKey` from `path-utils.ts` for duplicate path validation. CLI command modules import helpers directly from the SDK path-utils subpath when they are doing command-level collision or health checks.

#### Registry API rename

Rename the registry helper from `registerEntry` to `upsertEntry` because the helper validates and returns an entry for both insert and update flows. It is not limited to first registration.

The rename touches:

- `packages/squad-sdk/src/registry.ts`: export `upsertEntry`; keep validation and warning behavior unchanged.
- `packages/squad-sdk/src/index.ts`: update public exports as needed.
- CLI call sites that write or prepare registry entries, including init and assign flows.
- Test imports and assertions that call the registry helper.
- Any templates, fixtures, or skill docs in this stack that name the helper.

For compatibility, keep `registerEntry` as a deprecated alias that delegates to `upsertEntry` during this piece. Internal code must use `upsertEntry`; the alias exists only to avoid breaking external SDK consumers during the transition. The alias should not log or warn at runtime.

The helper behavior remains:

- Validate entry shape using the same rules as registry validation.
- Warn, but do not throw, when the entry path does not exist at write-preparation time.
- Preserve optional and unknown fields during read-modify-write flows.
- Return the validated entry object used by callers before `writeRegistry` persists the full registry.

Expected files from the manifest:

- a changeset file for SDK and CLI package changes
- `packages/squad-cli/src/cli/commands/install-hooks.ts`
- `packages/squad-cli/src/cli/commands/migrate-backend.ts`
- `packages/squad-cli/src/cli/commands/sync.ts`
- `packages/squad-cli/src/cli/commands/watch/config.ts`
- `packages/squad-cli/src/cli/core/init.ts`
- `packages/squad-cli/src/commands/__tests__/assign.test.ts`
- `packages/squad-cli/src/commands/__tests__/unassign.test.ts`
- `packages/squad-cli/src/commands/init.ts`
- `packages/squad-cli/src/commands/register.ts`
- `packages/squad-sdk/package.json`
- `packages/squad-sdk/src/index.ts`
- `packages/squad-sdk/src/path-utils.ts`
- `packages/squad-sdk/src/registry.ts`
- `packages/squad-sdk/src/resolution-v2.ts`
- `packages/squad-sdk/src/state-backend.ts`
- `test/cli/register-merge.test.ts`
- `test/cli/watch-triage-migration.test.ts`
- `test/registry-schema.test.ts`

If replay finds that a listed file no longer exists after predecessor pieces, update the closest current equivalent and document the substitution in the PR description. Do not add unrelated files to reach the manifest count.

## Tests

Required test updates:

- Add focused tests for `path-utils.ts` covering:
  - exact path equality;
  - case handling by platform;
  - symlink or realpath-aware equality where the platform supports it;
  - broken or unavailable realpath fallback;
  - clone-root match;
  - clone subdirectory match;
  - sibling-prefix non-match.
- Update registry schema tests to import and call `upsertEntry`.
- Keep a compatibility assertion that `registerEntry` still delegates to `upsertEntry` if the deprecated alias is retained.
- Keep resolver tests passing through the `resolution-v2.ts` `clonesMatch` re-export.
- Update CLI command tests that mock or import registry/path helpers.

Validation commands:

```powershell
npm run build
npm test
```

For targeted development, run the affected registry, resolver, path utility, and CLI command tests first, then run the full verification before the PR is ready.

## Compatibility and rollback

This piece is intended to be non-breaking.

Compatibility shape:

- `upsertEntry` is the canonical name for new code.
- `registerEntry` remains as a deprecated alias for external callers during this transition.
- `clonesMatch` remains available from the resolver module and is also available from the new path-utils module.
- Registry JSON remains backward-compatible because stored paths are not rewritten and the schema does not require a migration.

Rollback shape:

- Revert the path-utils extraction by moving helper implementations back to their previous modules only if needed.
- Revert internal call sites from `upsertEntry` to `registerEntry` only with the matching registry export change.
- Keep tests and API exports aligned in the same revert to avoid partial compile states.

## Notes

Follow Microsoft Style Guide: use direct, factual wording in code comments, test names, and PR text. Avoid historical framing; describe the design as current work.

Per the Core Dev charter, tests must move with the API change in the same commit. A rename that compiles but leaves stale tests, stale docs, or stale compatibility imports is not complete. Runtime correctness is the gate: all path comparisons must use the same helper semantics so command behavior and resolver behavior do not drift.


