# 09 — watch/triage resolution from state context

## Summary

This piece makes `watch` and `triage` use the registry-aware resolution result already carried by `stateContext`. Both commands are long-lived: `watch` starts a polling loop and `triage` routes through the same runner. Resolution must happen once at command startup, then subsequent setup and polling work must reuse the same resolved squad and state backend instead of running another resolver inside the loop.

## Context

Pieces 08a through 08c migrate the short-running command groups to the registry-aware resolver. `watch` and `triage` are different because they share `runWatch()`, and `runWatch()` owns startup, platform adapter creation, capability preflight, monitoring, and repeated poll rounds. Re-resolving inside that function can produce two problems:

- A consumer repository that resolves through a registry entry can fail the directory-walk `.squad/` check even though command entry already found the squad.
- A long-lived process can observe different state if environment variables, registry files, or the current directory change after startup.

The forward design is to treat command entry as the resolution boundary. `stateContext` becomes the stable runtime context for both state I/O and squad identity.

Use Microsoft Style Guide tone for new command messages: direct, actionable, and concise. Do not describe implementation history in user-facing text or PR notes.

## Scope and files

In scope:

- Extend the SDK `SquadStateContext` shape so it can carry the registry-aware resolver result.
- Update state-context resolution to populate that resolver result once at command entry.
- Thread `stateContext` through watch config loading and into `runWatch()`.
- Update `runWatch()` to consume `stateContext.resolution` before any fallback resolver work.
- Add or keep a `triage` command module re-export so tests can assert the shared command surface without duplicating the watch runner.
- Add focused tests for watch and triage resolving a shared squad from a consumer repository.
- Add a changeset because CLI and SDK source files are touched.

Expected files from the manifest:

- `.changeset/watch-triage-resolution.md`
- `packages/squad-cli/package.json`
- `packages/squad-cli/src/cli/commands/watch/index.ts`
- `packages/squad-cli/src/commands/triage.ts`
- `packages/squad-sdk/src/resolution.ts`
- `test/cli/watch-triage-migration.test.ts`

If replay finds that package export wiring has already been introduced by an earlier piece, keep the test import pointed at the current public command entry and document the substitution in the PR description.

Out of scope:

- Changing the watch polling algorithm.
- Changing platform adapter behavior.
- Changing registry file format or resolver priority.
- Adding live registry reload while a watch process is already running.

## Proposal

### State context shape

Existing `SquadStateContext` carries only filesystem and backend information:

| Field | Purpose |
| --- | --- |
| `paths` | Resolved `.squad/` paths used by SDK modules. |
| `backend` | Active state backend. |
| `repoRoot` | Repository root for backend operations. |
| `storage` | `StorageProvider` bound to the active backend. |

Add a field for the registry-aware resolver result:

```ts
import type { ResolvedSquad } from './resolution-v2.js';

export interface SquadStateContext {
  paths: ResolvedSquadPaths;
  backend: StateBackend;
  repoRoot: string;
  storage: StorageProvider;
  resolution: ResolvedSquad;
}
```

`resolution` is required when a context exists. `resolveSquadState()` should call the registry-aware resolver first, using the same start directory and environment available at command entry. When resolution succeeds, derive `paths` from `resolution.path` so both fields describe the same squad. When resolution returns no result, `resolveSquadState()` returns `null` as it does today. When resolution throws an ambiguity or validation error, let the command-level error path surface it rather than silently falling back to a different squad.

`ResolvedSquad` includes `path`, `source`, optional `callsign`, and optional `matchedOrigin`. `watch` primarily needs `path`; keeping the full result in context gives diagnostics, later state operations, and tests access to the same resolution source without another resolver call.

### Watch and triage startup

`cli-entry.ts` should continue to resolve state once, before `loadWatchConfig()`, and pass the context in the watch config overrides. `loadWatchConfig()` should preserve `stateContext` only from CLI overrides, not from `.squad/config.json`; JSON config must not inject runtime resolver state.

`runWatch(dest, options)` should normalize options, validate interval, and then establish its active squad directory in this order:

1. Use `config.stateContext?.resolution.path`.
2. For direct programmatic callers that do not provide a context, run the registry-aware resolver once with `cwd: dest` and the registry-path test seam.
3. If and only if no registry-aware result exists, use the directory-walk fallback for compatibility with callers that have not been migrated yet.

The resolver result is captured before `team.md`, `routing.md`, `teamRoot`, platform adapter creation, monitor state path, and capability loading are computed. After `activeSquadDir` is set, all later startup and every poll round use that captured value. `executeRound()` must not call the resolver or read `config.stateContext` again.

`triage` remains a thin alias to the same runner. A `commands/triage.ts` module may re-export `runWatch` as `runTriage` plus `loadWatchConfig` so tests and consumers can address the triage command surface directly.

### Failure behavior

Resolution failure at startup is fatal because the process cannot know which squad state to read or write. The command should print the existing actionable "No squad found — run init first." message when no resolver returns a squad. Ambiguous or invalid registry errors should surface their specific resolver message.

Resolution must not be repeated mid-loop. This means there is no mid-loop resolution failure mode after startup. If a registry file is edited, deleted, or made invalid while `watch` is already running, the active process continues with the startup context until it is stopped. Other transient failures inside a poll round, such as rate limits or platform scan failures, keep the current warn-and-continue behavior and must not be mixed with squad resolution.

## Tests

Required tests in `test/cli/watch-triage-migration.test.ts`:

| Test | Asserts |
| --- | --- |
| fixture sanity: resolver finds host squad from consumer cwd via `clones[]` | The fixture registry maps a consumer repository to a host `.squad/` directory before command assertions run. |
| watch resolves shared squad from consumer cwd | `runWatch()` does not fail with the "No squad found" message when the consumer repo has no local `.squad/` but registry resolution succeeds. |
| triage resolves shared squad from consumer cwd | The triage command path uses the same migrated runner and clears the same resolution gate. |
| state context wins over fallback | When `stateContext.resolution.path` is provided, `runWatch()` uses it without invoking a second resolver. |
| startup errors stay fatal | No resolved context and no fallback squad produces the existing init guidance; ambiguous resolver errors remain specific. |

Tests should isolate registry state with a registry-path option or environment seam. They should mock platform checks and the polling boundary so the assertions stop after startup resolution and do not require real platform credentials. Update tests in the same commit as the API change.

## Rollback

Revert the single piece commit. Rollback removes the `SquadStateContext.resolution` field, the watch/triage consumption path, the triage re-export if added only for this piece, the tests, and the changeset. No persisted data migration is required because the registry format and state backend data are unchanged.

## Notes for the implementer

Keep the context contract strict: if a `SquadStateContext` exists, its `paths.projectDir` and `resolution.path` must point to the same `.squad/` directory. Avoid optional `resolution` unless an existing test helper requires a temporary migration type; production code should not branch on a partially populated context.

Prefer a small helper inside `runWatch()` for resolving the startup squad directory so tests can exercise precedence without entering the full polling loop. Do not add live re-resolution to the interval handler; stable startup context is the point of this piece.

