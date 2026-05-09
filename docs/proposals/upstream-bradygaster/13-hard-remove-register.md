# 13 — Hard-remove `register`

> ⚠️ **BREAKING change:** Yes. `squad register` is no longer a supported command. Users must use `squad assign` to bind a checkout to a shared squad and `squad init` to create a new squad host.

## Summary

This piece removes the `register` command from the CLI command surface and replaces direct invocation with a short teaching error that points users to `assign`. The shared-squad lifecycle surface is now `assign` and `unassign`; `register` must not remain as a hidden lifecycle path, help entry, exported command module, or tested success flow.

Stack position: 13 of 20. Depends on 12 — Platform adapter. Tier 7 command pieces consume the completed registry, resolver, and platform seams.

## Context

The command model separates two user intents:

- create or prepare a squad host with `squad init`;
- bind or unbind working directories with `squad assign` and `squad unassign`.

Keeping `register` alongside this model creates two ways to mutate the same registry state. The CLI should instead fail fast when a user runs the removed command, explain the replacement, and leave all registry mutation to `assign`, `unassign`, and `init`.

This is a breaking command-surface change. It is intentional and user-facing. The error must be clear enough that existing scripts and manual workflows can be updated without reading implementation details.

## Scope and files

In scope:

- Remove the `register` command implementation module.
- Remove the CLI package export for `./commands/register` if it exists in the replay branch.
- Remove top-level help text that lists `register` as an available command.
- Add a command-dispatch branch for the removed command that prints a teaching error and exits with the command-usage failure code.
- Update guidance text in nearby commands that still tells users to run `squad register`.
- Delete or replace positive `register` tests with tests for the removal contract.
- Add a major changeset for the CLI package because the command is public CLI surface and, in the current package shape, the command module is also exported as a package subpath.

Out of scope:

- Changing registry JSON shape.
- Changing resolver priority order.
- Adding new `assign` or `unassign` behavior.
- Migrating user registry files.
- Keeping a compatibility alias that writes registry data.

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/remove-register-command.md` | major CLI changeset |
| `packages/squad-cli/package.json` | remove `./commands/register` export when present |
| `packages/squad-cli/src/cli-entry.ts` | teaching error and help cleanup |
| `packages/squad-cli/src/commands/register.ts` | remove command implementation |
| `test/cli/register.test.ts` | replace success-flow coverage with removal coverage, or delete if covered elsewhere |
| `test/cli/register-merge.test.ts` | remove merge-specific success coverage |
| `test/cli/register-installs-agent.test.ts` | remove install-specific success coverage |

If replay finds that a listed test file does not exist after predecessor pieces, update the closest current CLI test file that covers command dispatch or user guidance. Do not add unrelated files to match the manifest count.

## Proposal

### Command behavior

When a user runs `squad register` with any argument shape, the CLI must not call registry write helpers, copy payload files, inspect clone origins, or delegate to `assign`. It should print a teaching error to stderr and exit non-zero.

Required contract:

```text
ERR_SQUAD_REGISTER_REMOVED: squad register has been removed.
Use squad assign <callsign> to bind this checkout to a registered squad.
For a new squad host, run squad init --callsign <name>.
Run squad list to see registered squads.
```

Exit code: `2`.

The error code must appear in stderr so automated callers can assert the specific removal condition. The message must include `squad assign <callsign>` and must not suggest any `register` command form.

The dispatch branch should run before unknown-command handling so `squad register` always produces the teaching error rather than a generic unknown-command message. The branch should ignore additional flags and positional arguments because every `register` invocation has the same replacement guidance.

### Public surface removal

Remove command-surface references instead of keeping aliases:

- no `register` line in `squad help`;
- no `runRegister` import from `cli-entry.ts`;
- no `packages/squad-cli/src/commands/register.ts`;
- no CLI package export for `./commands/register`;
- no docs or tests that describe `register` as an available success path.

Guidance text that previously offered `squad register` should move to one of these actions:

- `squad assign <callsign>` for binding the current checkout;
- `squad assign <url> --clone-to <path>` for cold-start binding;
- `squad init --callsign <name>` for creating a new squad host;
- `squad doctor` for diagnosing existing local or registry state;
- `squad list` for discovering known callsigns.

### Changeset

Add a major changeset for the CLI package. The command is a public CLI subcommand, and the current package configuration also exports `./commands/register` as an importable subpath. The SDK package does not need a bump unless the replay implementation changes SDK exports.

## Test surface

Add or update tests for the following contracts.

| Test | Assertion |
| --- | --- |
| `squad register` teaching error | Running the CLI with `register` exits with code `2`, writes stderr containing `ERR_SQUAD_REGISTER_REMOVED`, and includes `squad assign <callsign>`. |
| `squad register` with old flags | Running `register --callsign alpha --path <path>` returns the same teaching error and does not create or modify a registry file. |
| Help surface cleanup | `squad help` and `squad --help` do not list `register` as a command. |
| Export surface cleanup | The CLI package no longer exports `./commands/register` when that subpath exists in the predecessor branch. |
| Stale guidance cleanup | List, init conflict, and no-squad guidance no longer tell users to run `squad register`; they point to `assign`, `init`, `doctor`, or `list` as appropriate. |
| Deleted success tests | Prior tests that verified register installation, clone merge, or origin merge behavior are removed or replaced by equivalent `assign` coverage owned by later pieces. |

Recommended targeted commands:

```powershell
npm test -- test/cli/register.test.ts test/cli/list-doctor.test.ts test/cli/init-scope.test.ts
npm run build
npm test
```

The teaching-error test is the parity gate for this piece. It must assert both the error code and the replacement command text so future edits do not reduce the message to a generic failure.

## Compatibility and rollback

Compatibility impact:

- Existing `squad register` scripts fail with exit code `2`.
- Existing package consumers importing the CLI register command subpath fail after the export is removed.
- Existing registry files remain valid and require no migration.
- `assign`, `unassign`, `init`, `list`, and `doctor` continue to operate on the same registry file.

Rollback should restore `register` only if the removal causes user confusion or breaks workflows that cannot migrate promptly. A rollback must restore the command implementation, package export, help entry, and positive register tests together so the CLI does not land in a partial state. If rollback is needed after later lifecycle pieces land, prefer a temporary teaching alias only when it calls the same registry mutation path as `assign`; do not restore divergent registry-write behavior.

## Notes

Follow Microsoft Style Guide: keep the teaching error direct, action-oriented, and free of apology or rationale. Use present-tense wording that describes the current command model.

Keep the design forward-looking. The proposal should not describe fork history or prior branch mechanics. The user-facing contract is simple: `register` is removed; `assign` is the binding command.
