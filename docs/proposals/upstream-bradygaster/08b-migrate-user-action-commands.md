# 08b — Migrate user-action commands to `resolveSquad()`

## Summary

This piece migrates the user-action command group to the shared resolver entry point introduced earlier in the stack. The affected commands are `assign-to-copilot`, `consult`, and `link`. Each command must settle squad resolution before it performs any file write, registry update, payload installation, clone operation, or other external call.

This piece stacks on 08a. Start the branch from the 08a branch, keep the same resolver-adoption pattern from that predecessor, and limit replay changes to the user-action command handlers plus shared dispatch glue needed to pass options and tests.

## Context

Pieces 01 through 07 establish registry parsing, registry-backed lookup, path helpers, command stubs, and merge semantics. Piece 08a applies the first command migration pattern to read-only commands: call `resolveSquad()` from the SDK resolver module, pass the current working directory and environment seams, handle `null` with the established user-facing message, and keep command-specific behavior unchanged after a squad is resolved.

The 08b commands differ because they can mutate disk or make external calls:

- `assign-to-copilot` can update registry clone metadata, install user-scope payload files, and optionally perform clone work.
- `consult` can create a project `.squad/config.json` and update local ignore or exclude state.
- `link` can create `.squad/config.json` and append a local ignore entry.

For these commands, resolution is not a convenience lookup. It is a precondition that must complete before any side effect starts, so failure leaves the project and user registry unchanged.

## Scope and files

In scope:

- Update the CLI dispatch path for `assign-to-copilot`, `consult`, and `link` so resolver inputs are settled before command runners perform side effects.
- Import and use `resolveSquad()` from the resolver module used by 08a.
- Thread `cwd`, `env`, `registryPath`, and explicit callsign options through command boundaries where needed.
- Preserve existing command messages, exit behavior, and dry-run behavior unless the resolver failure path requires the standard no-squad message.
- Add or update tests that prove side effects do not occur when resolution fails.
- Add a changeset because CLI source changes are expected.

Out of scope:

- Changing resolver priority order or registry schema.
- Changing the lifecycle command group owned by 08c.
- Changing read-only commands already owned by 08a.
- Redesigning the later shared-squad lifecycle surface.
- Adding new product-facing command names. If the current source has the action implemented under `assign`, migrate that handler for this piece without adding an alias unless the command surface already requires one.

Expected files from the manifest are intentionally broader than this replay slice. The manifest is the union for pieces 08a, 08b, and 08c. During replay, keep the actual diff scoped to user-action commands, focused tests, the changeset, and the shared dispatch glue required by those commands. Do not edit unrelated files only to match the manifest count.

Likely touched files:

- `.changeset/{descriptive-name}.md`
- `packages/squad-cli/src/cli-entry.ts`
- `packages/squad-cli/src/cli/commands/consult.ts`
- `packages/squad-cli/src/cli/commands/link.ts`
- `packages/squad-cli/src/commands/assign.ts` or the current source file that implements `assign-to-copilot`
- `test/cli/legacy-resolver-migration.test.ts` or current focused migration tests
- command-specific tests for assign, consult, or link if replay finds they are the closer test home

If a listed file has moved after predecessor pieces, update the current equivalent and document the substitution in the PR description.

## Proposal

### Resolver-adoption pattern

Follow the 08a pattern for all three commands:

1. Resolve once, at the outermost command boundary that still has the user's original `cwd`, command arguments, and environment.
2. Use `resolveSquad({ cwd, env, registryPath, callsign })` or the local wrapper adopted by 08a.
3. If the result is `null`, stop with the standard no-squad guidance before command code writes files or starts network work.
4. If the resolver throws a `SquadError`, surface the error through the existing CLI error path and stop before command code runs.
5. Pass the resolved `.squad` path, callsign, source, or matched origin into the runner only where the runner needs that data. Avoid re-resolving inside the runner unless the runner is directly invoked from tests and needs an injectable resolver seam.

The implementation should avoid mixed resolver behavior. A command must not resolve with the new chain in dispatch and then fall back to legacy directory walking inside the runner for the same operation.

### `assign-to-copilot`

Migrate the user-action handler that binds the current project to a registered squad and installs Copilot-facing payload files. If the source tree exposes this as `assign`, treat that handler as this piece's implementation target.

Required behavior:

- Resolve the squad before registry mutation, clone work, payload installation, or file writes.
- Preserve explicit callsign and URL handling. Resolver adoption must not make a URL without the required clone destination perform an implicit clone.
- Preserve idempotency when the current project is already assigned.
- Preserve collision checks for clone paths and normalized origins.
- Preserve rollback behavior for clone failures and host-verification failures.
- Preserve `SQUAD_REGISTRY_PATH` as the test and CLI seam for registry location.

Transactionality rules:

- Validation and resolver failure must leave registry files, project files, and user-scope payload files untouched.
- Clone failure must remove only directories created by the command for that attempt.
- Registry write must not happen until the target entry, clone path, and origin changes have all been validated.
- Payload installation must happen after successful registry persistence so a failed assignment does not leave an installed payload for an unbound project.

### `consult`

Migrate `squad consult` so shared-squad resolution is available before setup work starts.

Required behavior:

- `--status` remains query-only. It may inspect the local project consult config as it does today and must not create files.
- `--check` remains dry-run. It must exercise resolver and personal-squad lookup paths but must not write project config or ignore state.
- Normal setup must resolve first, then create or update consult-mode files only after resolver success.
- Existing personal-squad-not-found messaging remains unchanged.

The command has two identities to keep separate: the resolved project squad and the personal squad used for consultation. The migration should not collapse those into one path. The resolved project squad determines that the command is running in a valid squad context; the personal squad remains the source for consult-mode setup.

### `link`

Migrate `squad link <team-repo-path>` without changing its explicit target semantics.

Required behavior:

- Resolve the current squad context before creating local `.squad/` or appending ignore entries.
- Validate the explicit target path before writing local config, but do not rely on registry lookup to infer that target.
- Keep `teamRoot` relative to the project root in the written config.
- Preserve the local ignore entry behavior.

`link` may remain explicit-path driven after resolver adoption. The resolver check is a guard that the command is running from a valid squad-aware project context before it writes local link state.

## Tests

Required test updates:

- Add or update fixture coverage showing `resolveSquad()` succeeds from a consumer repository matched through registry clone data, then each user-action command reaches its normal command-specific behavior.
- Add failure-path tests proving no side effects occur when resolver returns `null` or throws before the command starts.
- For `assign-to-copilot`, assert registry and payload output are unchanged on resolver failure, URL-without-clone-destination failure, clone failure, and host verification failure.
- For `consult`, assert `--check` does not create `.squad/config.json`, and resolver failure does not create consult files or ignore entries.
- For `link`, assert resolver failure does not create `.squad/config.json` and does not append to `.gitignore`; success still writes the relative `teamRoot` config.
- Keep existing assign behavior matrix tests passing if that matrix exists in the current branch.

Validation commands:

```powershell
npm run build
npm test
```

For targeted development, run the migration test file and command-specific tests first, then run full verification before the PR is ready.

## Compatibility and rollback

This piece is intended to be non-breaking. It changes how commands find the active squad, not the command names, flag meanings, registry file shape, or user-facing success output.

Compatibility shape:

- Worktree-local `.squad/` resolution remains valid.
- Registry clone and origin resolution become valid for these commands.
- Explicit command flags continue to override inferred defaults where they already do.
- Dry-run and status modes remain non-mutating.

Rollback shape:

- Revert the single piece commit, including tests and changeset.
- If only one command needs rollback during review, revert that command's resolver adoption and its focused tests together so behavior and tests stay aligned.
- Do not leave dispatch using one resolver while the runner uses another resolver for the same operation.

## Notes

Follow Microsoft Style Guide: use direct, factual wording in code comments, test names, and PR text. Describe the design as current work, not as a recreation of prior history.

The manifest reports about 30 files because it is shared across the 08a, 08b, and 08c command-migration split. For this piece, the replay diff should be smaller and scoped to user-action commands plus shared dispatch glue. Record any file substitutions in the PR description.

This branch must be based on the 08a branch. If 08a has not landed, create the 08b branch from the latest 08a branch and rebase after 08a changes. Re-run scrub, build, and test gates after every rebase.

The main correctness gate is ordering: no writes, clone operations, payload installation, or external calls may occur until resolver success is known. Tests should prove that ordering directly, not only by checking the happy path.
