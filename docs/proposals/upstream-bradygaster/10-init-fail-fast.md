# 10 — init fail-fast

## Summary

This piece makes `squad init` fail before writing files when the target already represents a squad or the registry already maps the requested identity or checkout. The command must not silently merge into an existing scaffold, reuse an active callsign, or create another registry entry for a checkout that already appears in `clones[]`.

**Stack position:** 10 of 20  
**Depends on:** 09 — watch/triage resolution  
**Tier:** 4  
**Breaking change:** No  
**Primary scope:** CLI init safety checks

## Context

Earlier stack pieces add a validated registry, path comparison helpers, and registry-backed resolution. `squad init` now has enough information to detect conflicts before scaffold creation. Without these guards, init can appear successful while preserving or extending stale local state, which makes later command resolution harder to diagnose.

The command should treat conflict detection as an initial validation step. It should load the registry, resolve the target `.squad/` path, derive or read the callsign, and inspect registered clone roots before any scaffold file or registry write occurs.

## Scope and files

In scope:

- Add fail-fast validation checks to `packages/squad-cli/src/commands/init.ts`.
- Wire the command entry path in `packages/squad-cli/src/cli-entry.ts` so init conflict errors exit with the conflict exit code.
- Add CLI tests in `test/cli/init-scope.test.ts` for each failure mode.
- Update existing init tests in `test/cli/init-v2.test.ts` where they previously expected non-destructive merge behavior.
- Add a patch changeset for the CLI package.

Out of scope:

- Changing the registry JSON shape.
- Changing resolver priority order.
- Adding interactive prompts.
- Migrating existing registry files.
- Removing or renaming lifecycle commands owned by later stack pieces.

Expected files:

| Path | Role |
| --- | --- |
| `.changeset/init-fail-fast.md` | CLI patch changeset |
| `packages/squad-cli/src/commands/init.ts` | init validation implementation |
| `packages/squad-cli/src/cli-entry.ts` | conflict exit-code mapping for init |
| `test/cli/init-scope.test.ts` | focused fail-fast contract tests |
| `test/cli/init-v2.test.ts` | update existing init expectations |

## Proposal

### Command behavior

`runInit()` should perform one validation pass before scaffolding or writing the registry:

1. Resolve `targetDir` from `--target-dir` or the caller's current working directory.
2. Compute `squadDir = path.join(targetDir, '.squad')`.
3. Load `registry.json` from `--registry-path`, `SQUAD_REGISTRY_PATH`, or the default user registry path.
4. Determine `effectiveCallsign` from `--callsign` or the target directory basename.
5. Check for scaffold, callsign, and clone-path conflicts.
6. Only after every check passes, create scaffold files and write or update the registry.

All three conflicts throw `SquadError` with category `CONFIGURATION`, severity `ERROR`, and `recoverable: false`. The CLI prints the message to stderr and exits with code `2` for these conflict errors. Non-conflict init failures continue to use the existing general failure behavior.

### Conflict rules

#### Existing scaffold

If `targetDir\.squad` already exists as a directory and contains a scaffold sentinel, init must fail before writing any file. The sentinel set should include `team.md`; implementations may also treat known scaffold files such as `routing.md`, `decisions.md`, `config.json`, or `.github\agents\squad.agent.md` as evidence if they are already part of the init template.

Contract:

```text
ERR_SQUAD_INIT_EXISTING_SCAFFOLD: .squad/ already exists at <targetDir>. squad init will not overwrite it. Run squad doctor to inspect registration status, or choose a different --target-dir.
```

Exit code: `2`.

#### Callsign collision

If `effectiveCallsign` matches an active registry entry whose `path` is not the same normalized `.squad/` path, init must fail before scaffold creation. This applies both to an explicit `--callsign` and to a basename-derived callsign.

Contract:

```text
ERR_SQUAD_INIT_CALLSIGN_EXISTS: callsign "<callsign>" is already registered at <existingPath>. Choose a different --callsign or target directory.
```

Exit code: `2`.

A same-path active entry is also a conflict for init if a scaffold sentinel already exists. Init should not report success for an already initialized target.

Inactive entries may be handled by later lifecycle work. This piece should not reactivate an inactive entry unless that behavior already exists in the predecessor branch and has explicit tests; the fail-fast checks must still run before any scaffold write.

#### Clone-path collision

If the operation directory matches any active registry entry's `clones[]` value through the shared clone path comparison helper, init must fail before scaffold creation. The operation directory is `targetDir` when `--target-dir` is supplied and the current working directory otherwise.

Contract:

```text
ERR_SQUAD_INIT_CLONE_PATH_EXISTS: this directory is already registered as a clone for callsign "<callsign>". Run squad doctor to inspect the registry, or choose a different directory.
```

Exit code: `2`.

The check must use the same sentinel-bound path semantics as resolver clone matching: exact clone root and child paths match; sibling prefixes do not.

### Ordering

Validation order should be deterministic and user-facing:

1. Existing scaffold at the target.
2. Callsign collision.
3. Clone-path collision.

This order keeps the error closest to the user's immediate action. For example, an already scaffolded directory should report that local fact before reporting a registry collision.

## Test surface

Add or update tests for the following contracts.

| Failure mode | Test assertion | Error code and message contract | Exit code |
| --- | --- | --- | --- |
| Existing scaffold | Pre-seed `targetDir\.squad\team.md`, run init, and verify the sentinel file is unchanged. | `ERR_SQUAD_INIT_EXISTING_SCAFFOLD`; message contains `.squad/ already exists at <targetDir>` and `will not overwrite`. | `2` |
| Callsign collision, explicit | Registry contains active `{ callsign: 'alpha', path: '<other>\.squad' }`; run `squad init --callsign alpha`. | `ERR_SQUAD_INIT_CALLSIGN_EXISTS`; message contains `callsign "alpha" is already registered at <other>\.squad`. | `2` |
| Callsign collision, derived | Target basename is `alpha`; registry already contains active callsign `alpha`; run init without `--callsign`. | Same `ERR_SQUAD_INIT_CALLSIGN_EXISTS` contract. | `2` |
| Clone-path collision | Registry entry contains `clones: [<cloneRoot>]`; run init from `<cloneRoot>` or a child directory. | `ERR_SQUAD_INIT_CLONE_PATH_EXISTS`; message contains `already registered as a clone for callsign "<callsign>"`. | `2` |

Additional assertions:

- Each fail-fast test verifies no scaffold files are created and no registry write occurs after the conflict.
- Clone-path tests include a sibling-prefix non-match to confirm `repo` does not match `repo-tools`.
- Clean init with `--callsign` still creates `.squad/` and registers the requested callsign.
- Clean init without `--callsign` still derives the target basename.
- `--no-register` skips registry writes on clean init but does not bypass the existing-scaffold guard.
- CLI-level tests verify stderr output and process exit code for the three error codes.

Validation commands:

```powershell
npm run build
npm test -- test/cli/init-scope.test.ts test/cli/init-v2.test.ts
npm test
```

## Compatibility and rollback

This is a safety change, not a registry migration. Existing registry files remain valid, and clean init behavior remains unchanged.

Compatibility expectations:

- Existing callers can still initialize a new directory.
- Existing callers can still pass `--callsign`, `--target-dir`, `--registry-path`, and `--no-register`.
- A directory that already has a scaffold now returns a clear conflict instead of treating init as a merge or no-op.
- Registry conflicts are reported before any filesystem mutation.

Rollback is limited to the CLI init command, CLI entry error mapping, related tests, and the changeset. Reverting this piece restores predecessor init behavior without data migration.

## Notes

Follow Microsoft Style Guide principles for direct, factual wording in code comments, test names, stderr text, and PR text. Keep the design forward-looking: init creates a new squad scaffold; it does not repair, merge, or claim an existing one.

Keep tests and API behavior in the same commit. If the implementation adds a helper for conflict creation, export only what tests need; prefer command-level tests for user-facing behavior and unit tests for path comparison only where the shared helper is involved.
