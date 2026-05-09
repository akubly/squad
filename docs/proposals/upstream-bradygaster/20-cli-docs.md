# 20 — CLI reference and shared-squad guide

## Summary

This piece refreshes the user-facing command documentation after the shared-squad lifecycle surface is complete. It updates the CLI help text, CLI reference, shared-squad guide, and README command table so users see one current model: create a squad host with `squad init`, bind product repositories with `squad assign`, unbind with `squad unassign`, inspect health with `squad doctor`, and receive Copilot payload files through assignment.

Stack position: Part 20/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 19 — Copilot payload on assign. This is a non-breaking documentation and help-text update.

## Problem

The command surface now has a complete lifecycle model, but several user-facing pages still mix older setup language with the new commands. That creates three risks:

- users may follow stale setup steps and run removed or superseded commands;
- the CLI reference may describe flags, exit codes, or recovery paths that no longer match the command behavior;
- shared-squad setup may omit the Copilot payload effect, leaving users unclear about when skills, agents, and MCP entries appear in their user-scoped Copilot directory.

The docs need to teach the current workflow directly. A user should be able to start at the README, open the CLI reference, or follow the shared-squad guide and get the same command sequence, terms, and recovery steps.

## Proposed change

Update the documentation for three audiences:

1. **New users reading the README.** Keep the command table short, current, and task-based. Place `init`, `assign`, `unassign`, `list`, and `doctor` near the top. Describe `assign` as both the warm-path binding command and the explicit cold-start command with `--clone-to`.
2. **Users checking command details.** Expand the CLI reference so `init`, `assign`, `unassign`, and `doctor` each have a synopsis, flags table, exit codes, examples, and recovery paths. Include `--target-dir`, `--registry-path`, `--no-register`, `--clone-to`, `--purge`, and `--normalize-callsigns` where applicable.
3. **Teams setting up shared squads.** Rewrite the shared-squad guide around the current lifecycle: create or clone a state-host repository, run `squad init --callsign <name>` in the host, run `squad assign <callsign>` from product repositories, use `squad assign <url> --clone-to <path>` for first-time setup, verify with `squad status`, and use `squad doctor` for health checks.

The docs should add examples for:

- initializing a host with a callsign;
- assigning by callsign after the host is registered;
- assigning by URL with `--clone-to` when the host is not registered locally;
- unassigning without deleting host files;
- using `doctor --purge` to remove an inactive registry entry;
- using `doctor --normalize-callsigns` to detect or fix callsign case collisions;
- understanding that assign installs host `.copilot/` payload into the user-scoped Copilot home with callsign-prefixed skill, agent, and MCP names.

Also update the actual `squad --help` output so the terminal help and docs agree. Remove stale lifecycle guidance and avoid documenting old setup modes as the recommended shared-squad path.

## API surface

Document these command shapes consistently:

```text
squad init [--callsign <name>] [--target-dir <path>] [--registry-path <file>] [--no-register]
squad assign <callsign> [--target-dir <path>] [--registry-path <file>]
squad assign <url> --clone-to <path> [--callsign <name>] [--target-dir <path>] [--registry-path <file>]
squad unassign [<callsign>] [--target-dir <path>] [--registry-path <file>]
squad list [--registry-path <file>]
squad doctor [--registry-path <file>]
squad doctor --purge <callsign> [--yes] [--registry-path <file>]
squad doctor --normalize-callsigns [--apply] [--yes] [--registry-path <file>]
```

Documentation rules:

- `squad init` creates or reuses the host scaffold and registers it unless `--no-register` is set.
- `squad assign <callsign>` binds the selected product repository to an existing registry entry.
- `squad assign <url> --clone-to <path>` is the only documented auto-clone path.
- URL input without `--clone-to` is a usage error with a recovery recipe.
- `squad unassign` removes the consumer binding and never deletes the host repository or product repository.
- inactive entries stay discoverable and can be reactivated by assign or removed by explicit purge.
- Copilot payload installation is an assign-side effect; unassign removes only the namespaced payload for the selected callsign.

## Test surface

Add focused docs-build assertions in `test/docs-build.test.ts` instead of relying only on generic markdown and Astro build checks.

| Test | Assertion |
| --- | --- |
| CLI reference includes current lifecycle commands | `docs/src/content/docs/reference/cli.md` contains `squad assign <callsign>`, `squad assign <url> --clone-to <path>`, `squad unassign`, `squad doctor --purge`, and `squad doctor --normalize-callsigns`. |
| CLI reference excludes removed command guidance | The CLI reference does not document the removed lifecycle command as an available command or recovery path. |
| Shared-squad guide teaches warm and cold setup | `shared-squad.md` contains both `squad init --callsign` and `squad assign <url> --clone-to <path>`. |
| Shared-squad guide mentions payload delivery | `shared-squad.md` explains that assignment installs `.copilot/` skills, agents, and MCP entries into the user-scoped Copilot home under callsign-prefixed names. |
| README command table stays aligned | `README.md` includes `assign`, `unassign`, `list`, and the doctor cleanup flags in the command table. |
| Help text stays aligned | A CLI help test, or the closest existing CLI routing test, asserts that `squad --help` lists `assign`, `unassign`, the updated `init` flags, and the doctor health flags. |

Validation commands:

```powershell
npm run build
npm test -- test\docs-build.test.ts
npm test
```

If the docs site has a separate package build, also run the existing docs build command from `docs\`.

## Files

Expected files from the manifest:

| Path | Role |
| --- | --- |
| `.changeset/cli-docs-shared-squad.md` | patch changeset for user-facing docs and help text |
| `README.md` | top-level command table and shared-squad entry points |
| `docs/src/content/docs/guide/shared-squad.md` | setup flow, warm and cold assignment, status, doctor, payload notes |
| `docs/src/content/docs/reference/cli.md` | detailed command reference for lifecycle commands |
| `test/docs-build.test.ts` | docs-build assertions for command surface and page content |

Additional file when terminal help is not already current:

| Path | Role |
| --- | --- |
| `packages/squad-cli/src/cli-entry.ts` | `squad --help` command list and flag descriptions |

If replay finds the terminal help already matches the command surface after predecessor pieces, leave `cli-entry.ts` untouched and state that in the pull request description. Do not edit unrelated docs to match a target file count.

## Notes

Follow Microsoft Style Guide: use sentence-case headings, active voice, present tense, and direct recovery steps. The writing should be factual, scannable, and consistent across README, CLI reference, terminal help, and the shared-squad guide.

Apply tone and record discipline while authoring: describe the current product behavior and forward design only. Do not include branch history, implementation provenance, internal channel names, or stale milestone labels in the proposal, docs, tests, or pull request text.

Rollback is a single-piece revert of the docs, help-text, tests, and changeset. No user data migration is required.
