# 19 — Copilot payload on assign

## Summary

This piece extends `squad assign` so a successful assignment also installs the shared squad's Copilot payload into the user's Copilot home. The payload includes skills, agents, custom instructions, and MCP server entries that the local Copilot CLI can discover from user scope without depending on the current working directory.

Stack position: Part 19/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 14 — `squad assign`. This is a non-breaking CLI lifecycle enhancement.

## Context

Piece 14 records the durable binding between a product clone and a shared squad host. That binding makes registry-backed resolution work, but it does not by itself make Copilot CLI discover the squad's skills and agents when the user runs Copilot from a product repository.

Assignment is the right install point because it is explicit, already resolves the shared squad host, and is idempotent. After assign completes, the selected product clone is both registered as a consumer and ready for Copilot CLI use with the squad payload from user scope.

The user-scoped Copilot home is:

| Platform | Default path |
| --- | --- |
| Windows | `%USERPROFILE%\.copilot` |
| macOS | `$HOME/.copilot` |
| Linux | `$HOME/.copilot` |

Tests may pass an explicit `copilotHome` option. Product behavior should also respect an existing Copilot home override if the command surface already supports one for isolated environments.

## Scope and files

In scope:

- Add SDK helpers for installing, removing, and diagnosing user-scoped Copilot payload files.
- Call the install helper from both warm-path and cold-start `squad assign` after the registry write succeeds.
- Add `--skills-from <source>` to `squad assign` so users can select which skill set is installed.
- Keep install behavior deterministic and non-interactive; do not prompt during assign.
- Remove the namespaced payload on `squad unassign`.
- Surface orphaned user-scoped payload entries in `squad doctor`.
- Add command and payload tests in the same commit as the API and CLI wiring.
- Add a changeset for CLI and SDK behavior changes.

Out of scope:

- Changing registry schema.
- Installing payload files into the product repository.
- Downloading skill sources from the network.
- Adding a separate interactive payload management command.
- Changing the assign guard order or cold-start clone guarantees from piece 14.

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/*copilot-payload*.md` | package changeset |
| `packages/squad-cli/src/commands/assign.ts` | command option parsing and install call |
| `packages/squad-cli/src/commands/unassign.ts` | payload cleanup call |
| `packages/squad-cli/src/commands/doctor.ts` | orphaned payload diagnostics |
| `packages/squad-cli/src/commands/__tests__/copilot-payload.test.ts` | payload behavior tests |
| `packages/squad-sdk/package.json` | SDK export for payload helpers |
| `packages/squad-sdk/src/copilot-payload.ts` | install, uninstall, and diagnostic helpers |

If replay finds that a predecessor piece already owns an integration file, keep the diff surgical and document the substitution in the pull request description.

## Proposal

### Command surface

Extend assign with an optional flag:

```text
squad assign <callsign> [--skills-from <source>] [--registry-path <file>] [--target-dir <path>]
squad assign <url> --clone-to <path> [--callsign <name>] [--skills-from <source>] [--registry-path <file>] [--target-dir <path>]
```

`--skills-from <source>` controls only skill installation. Agents, instructions, coordinator files, and MCP entries still come from the assigned squad host. The supported sources are:

| Source | Meaning |
| --- | --- |
| omitted or `host` | Install skills from `<squad-host>/.copilot/skills`. |
| `none` | Skip skill installation while still installing the rest of the payload. |
| local path | Install skills from a local directory. The path may point to a `.copilot` directory, a `skills` directory, or a directory that contains skill directories. Relative paths resolve from the command working directory. |

URLs and registry identifiers are not accepted as sources in this piece. If the value looks like a URL or resolves to no local directory, assign fails with a usage error before writing payload files.

The testable API should expose the option without requiring CLI integration tests for every branch:

```ts
export interface RunAssignOpts {
  callsign?: string;
  url?: string;
  cloneTo?: string;
  callsignOverride?: string;
  registryPath?: string;
  cwd?: string;
  targetDir?: string;
  copilotHome?: string;
  skillsFrom?: string;
}

export interface InstallCopilotPayloadOpts {
  copilotHome?: string;
  skillsFrom?: string;
}
```

### Install layout

Install payload files under the user-scoped Copilot home with names that can coexist across squads:

| Source | Destination | Conflict behavior |
| --- | --- | --- |
| `.copilot/skills/<name>/` | `<copilotHome>/skills/squad-<callsign>-<name>/` | Replace this callsign's target directory, then copy fresh. |
| `.copilot/agents/*.agent.md` | `<copilotHome>/agents/squad-<callsign>-<name>.agent.md` | Replace this callsign's target file. |
| `.copilot/instructions/**` | `<copilotHome>/instructions/squad-<callsign>/**` | Replace this callsign's instruction directory. |
| `.copilot/mcp-config.json` | `<copilotHome>/mcp-config.json` | Merge `mcpServers` with `squad-<callsign>-` key prefixes; preserve unrelated keys. |
| `.github/agents/squad.agent.md` | `<copilotHome>/agents/squad.agent.md` | Refresh the shared coordinator file. |

The coordinator file is sourced from `.github/agents/squad.agent.md`, not from `.copilot/agents`. It is installed once per user and is shared by all assigned squads. Per-squad agent files remain namespaced.

When copying skills or agents, rewrite a YAML frontmatter `name:` field to the installed namespaced name. Preserve all other frontmatter fields and file content. Do not rewrite the shared coordinator file.

### Conflict handling

Assign must not overwrite unrelated user configuration. It may replace only files or keys owned by the selected callsign namespace:

- Replace existing `squad-<callsign>-*` skill directories and agent files during install.
- Preserve other callsigns' payload files.
- Preserve user-created skills, agents, instructions, and MCP server entries that do not use the selected namespace.
- Replace `mcpServers` keys with the selected `squad-<callsign>-` prefix, then add the current host entries.
- Preserve existing non-prefixed MCP configuration and top-level JSON fields.

Do not prompt for merge decisions. Re-running assign is the repair path and must produce the same installed state for the selected callsign.

If the install cannot read the source or write the user-scoped destination, assign reports an I/O error. The registry binding remains valid; the user can rerun `squad assign <callsign>` after fixing permissions or the source path.

### Assign and unassign flow

For warm-path assign, install the payload after the registry write succeeds and after idempotency checks confirm the target is assigned. For cold-start assign, install after the clone has been validated, the registry entry has been created or reactivated, and the target clone has been bound.

Missing payload directories are not errors:

- no `.copilot/` directory means no skills, agents, instructions, or MCP entries are installed;
- no `.copilot/skills/` means no skills are installed;
- no `.github/agents/squad.agent.md` means no shared coordinator is installed.

The result object should include whether the shared coordinator was installed so CLI output can describe the actual state rather than assumed work.

`squad unassign` removes only the selected callsign's namespaced payload. It removes the shared coordinator only when no other `squad-*-*.agent.md` files remain in the user-scoped agents directory.

### Idempotency

Payload install is convergent:

- running assign twice for the same callsign and source produces the same files and MCP keys;
- stale files inside this callsign's previous skill or instruction directory are removed;
- other callsigns' payload files remain untouched;
- `--skills-from none` removes this callsign's previously installed skill directories and leaves the rest of the payload installed;
- uninstall succeeds even when no payload exists for the callsign.

`squad doctor` should warn about namespaced skills or agents whose callsign no longer appears in the registry. It should not delete them unless an explicit cleanup command already owns that action.

## Tests

Required test coverage:

| Test | Assertion |
| --- | --- |
| skill install | copies `.copilot/skills/<name>/` to `skills/squad-<callsign>-<name>/`. |
| skill frontmatter | rewrites only `name:` in `SKILL.md`. |
| recursive skill copy | copies all files under a skill directory. |
| skill source path | `--skills-from <path>` installs skills from the selected local source. |
| skill source none | `--skills-from none` removes this callsign's existing skill payload and skips skill copy. |
| invalid skill source | URL-like or missing source fails before writing payload files. |
| agent install | copies `.agent.md` files with callsign-prefixed names and frontmatter names. |
| coordinator install | copies `.github/agents/squad.agent.md` to `agents/squad.agent.md` and returns a true install flag. |
| coordinator absence | returns a false install flag without writing a coordinator file. |
| instructions install | copies instructions under an isolated `instructions/squad-<callsign>/` directory. |
| MCP merge | adds callsign-prefixed server keys and preserves unrelated keys. |
| MCP refresh | replaces only this callsign's prefixed keys on repeat assign. |
| missing payload | missing or empty payload directories do not throw. |
| install idempotency | repeat install removes stale files in this callsign's namespace and recopies current content. |
| uninstall cleanup | removes only this callsign's skills, agents, instructions, and MCP keys. |
| coordinator cleanup | preserves the shared coordinator while another squad payload remains and removes it after the last one. |
| multi-squad coexistence | two callsigns can install, refresh, and uninstall independently. |
| doctor orphan warning | reports namespaced skills or agents whose callsign is not in the registry. |
| assign integration | warm-path and cold-start assign call payload install with the resolved host path, callsign, Copilot home, and skill source. |

Validation commands:

```powershell
npm run build
npx vitest run packages\squad-cli\src\commands\__tests__\assign.test.ts packages\squad-cli\src\commands\__tests__\copilot-payload.test.ts packages\squad-cli\src\commands\__tests__\unassign.test.ts packages\squad-cli\src\commands\__tests__\doctor.test.ts
npm test
```

Run the upstream scrub gate before opening the pull request.

## Compatibility and rollback

This piece is non-breaking. It adds an assign-side effect, an assign option, SDK helper exports, uninstall cleanup, and doctor diagnostics. Registry JSON remains backward-compatible and no product repository files are written.

Compatibility shape:

- existing assignments remain valid;
- existing user Copilot home files remain intact unless they are in the selected callsign namespace;
- payload install can be repaired by rerunning assign;
- unassign is safe to rerun;
- unknown registry fields and existing assign semantics from piece 14 are preserved.

Rollback shape:

- remove the payload helper export and implementation;
- remove assign option parsing and install calls;
- remove unassign cleanup calls and doctor orphan checks;
- remove payload tests and changeset.

Rollback does not require registry migration. User-scoped payload files already installed by a reverted build can be left in place or removed by a later cleanup command because they are namespaced by callsign.

## Notes

Follow Microsoft Style Guide: use sentence-case headings, active voice, present tense, and direct recovery steps. User-facing messages should say what happened, where files were installed, and what command to rerun when repair is needed.

Keep the implementation forward-looking. The installer should use narrow namespace ownership instead of broad directory replacement, avoid prompts so CI and scripting remain stable, and treat assign as the convergent repair operation for user-scoped Copilot payload state.
