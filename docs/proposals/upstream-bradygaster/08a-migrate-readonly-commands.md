# 08a — Migrate read-only commands

> Stack position: Part 08a/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 07 — register merges clones[]/origins[].

## Summary

This piece migrates the read-only CLI commands `status`, `list-related`, and `dev` to resolve squads through the structured `resolveSquad()` chain. It establishes the shared command-side adoption pattern for the sibling migration pieces while keeping this replay limited to commands that only inspect state.

## Context

The registry-backed resolver can find a shared squad from a consumer checkout through `~/.squad/registry.json`, `clones[]`, `origins[]`, or explicit callsign selection. Some command dispatch paths still resolve only by walking from the current working directory to a local `.squad/` directory. In those paths, a correctly registered consumer checkout can still appear to have no active squad.

Read-only commands are the lowest-risk first group because they do not write registry entries, install files, start tunnels, launch child processes, or change project state. They are also a good place to define the common dispatcher helper before later pieces migrate user-action and lifecycle commands.

## Scope and files

In scope:

- Migrate `squad status` resolution.
- Migrate `squad list-related` resolution.
- Migrate `squad dev` resolution.
- Add shared dispatch glue in `packages/squad-cli/src/cli-entry.ts` for commands that only need the resolved `.squad/` path.
- Add or update focused tests for the three read-only commands.
- Add a CLI changeset because `packages/squad-cli/src/` is touched.

Out of scope:

- User-action commands: `assign-to-copilot`, `consult`, and `link`.
- Lifecycle commands: `start` and `rc`.
- Watch or triage runtime resolution.
- Resolver priority changes.
- Registry schema or registry write behavior.

Expected files for this sub-piece:

| Path | Role | Approx LOC |
|------|------|------------|
| `.changeset/migrate-readonly-commands.md` | CLI changeset for read-only resolver adoption | 8 |
| `packages/squad-cli/src/cli-entry.ts` | Shared dispatch helper and read-only command wiring | 45 |
| `packages/squad-cli/src/commands/status.ts` | Status formatting helpers if metadata fields are added or adjusted | 80 |
| `packages/squad-cli/src/commands/__tests__/status.test.ts` | Unit tests for status metadata formatting, if touched | 140 |
| `test/cli/legacy-resolver-migration.test.ts` | Integration coverage for the three read-only commands | 130 |

If the current upstream tree uses a different module name for `list-related` or `dev`, update the closest current command module for that command and document the substitution in the PR description. Do not migrate sibling command groups to match the manifest's total file list.

## Proposal

### Shared resolver adoption pattern

Add one shared dispatch helper in `packages/squad-cli/src/cli-entry.ts` for commands that only need a `.squad/` path:

```ts
import { resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk/resolution-v2';

function resolveSquadDir(cwd: string): string | null {
  return resolveSquadV2({ cwd, env: process.env })?.path ?? null;
}
```

Use this helper instead of the current string-returning resolver anywhere this piece's read-only commands pre-resolve from the CLI dispatcher. Keep the helper local to dispatch glue unless an existing command module needs a typed import directly.

Commands that need resolution metadata, especially `status`, may call `resolveSquadV2({ cwd, env })` directly and then use `.path` for existing path checks. Do not route metadata-bearing commands through a string-only helper if doing so would require a second resolver call.

### Command behavior

`status` should resolve the active squad from the structured resolver chain. If the result comes from a registry-backed source, the command should still display the existing status block and may append registry-specific details without removing existing labels. If the resolver returns `null`, keep the current personal/global fallback behavior.

`list-related` and `dev` should use the resolved `.squad/` path from `resolveSquadDir(getSquadStartDir())` or an equivalent direct `resolveSquadV2` call. Existing command output, arguments, and exit behavior should remain unchanged except that registered consumer checkouts now resolve to the host squad.

Resolver errors that represent invalid explicit selection or ambiguous registry state should surface as command failures with the existing CLI error path. Do not silently fall back to personal/global state after an ambiguity error.

## Tests

Add or update tests in `test/cli/legacy-resolver-migration.test.ts` for the read-only group. Use an isolated fixture with:

- a host repository containing `.squad/`
- a consumer repository with no `.squad/`
- `registry.json` containing the host `.squad/` path and the consumer clone path
- `SQUAD_REGISTRY_PATH` pointed at the fixture registry

| Test | Asserts |
|------|---------|
| `fixture resolves registered consumer checkout through resolveSquad` | The structured resolver returns the host `.squad/` path from the consumer CWD with `source: 'clones'`. |
| `status resolves a registered consumer checkout` | The `status` dispatch path uses the structured resolver result and reports the host squad instead of falling through to `none` or personal/global state. |
| `list-related resolves a registered consumer checkout` | The command uses the host `.squad/` path when invoked from the consumer CWD and does not throw the current not-found error. |
| `dev resolves a registered consumer checkout` | The command uses the host `.squad/` path when invoked from the consumer CWD and preserves existing read-only behavior. |
| `read-only migration does not pull in action commands` | The test file or changed dispatch assertions are scoped to `status`, `list-related`, and `dev`; sibling command groups are left to their own pieces. |

If a command lacks a standalone runner, test the smallest exported helper or dispatcher seam available. It is acceptable to add a small pure helper for status formatting or resolution selection when that keeps the test focused and avoids starting an interactive command.

Validation commands:

```bash
npm run build
npm test -- test/cli/legacy-resolver-migration.test.ts packages/squad-cli/src/commands/__tests__/status.test.ts
```

## Compatibility and rollback

This piece is intended to be non-breaking. Existing command flags, output shape, and fallback behavior should remain stable except for the corrected ability to resolve a registered consumer checkout.

Rollback is a single-commit revert. Reverting restores the read-only commands to the previous resolver path and removes the read-only migration tests and changeset. Registry schema and resolver SDK pieces remain in place because they are owned by earlier stack pieces.

## Notes for the implementer

This piece is intentionally narrower than the manifest's file union. The manifest lists the combined 08a/08b/08c source surface, around 30 files, because all three sub-pieces share some dispatch and test files. During replay for this sub-piece, touch only the read-only command files plus shared dispatch glue needed by `status`, `list-related`, and `dev`.

Keep this as a forward design. Do not describe the work as a replay from another branch or as a comparison with older implementations. Use Microsoft Style Guide tone: direct, plain language; no promotional phrasing.

Run the scrub gate for this stack before opening the PR.
