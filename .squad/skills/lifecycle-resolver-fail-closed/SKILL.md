# Skill: Lifecycle Resolver Fail-Closed Review

## Context

Lifecycle commands start durable resources such as bridges, tunnels, PTYs, child processes, signal handlers, and audit streams. Resolver mistakes have a higher blast radius here than in short-lived commands because the wrong squad identity can remain live after startup.

## Pattern

For any command that starts long-running state:

1. Resolve the squad before importing or invoking the runner.
2. Treat resolver ambiguity, malformed explicit registry input, and stale resolved paths as fatal startup errors.
3. Validate that the resolved squad path is an existing directory before passing it to bridge metadata or roster loading.
4. Keep subprocess CWD as the user-facing start directory; use the resolved squad path only for squad metadata and roster reads.
5. Test both failure and success paths with assertions that no bridge, tunnel, PTY, or child process starts on resolver failure.

## Implementation Notes (added 2026-05-14T17:54:18Z — GNC 08c revision)

**Confidence: HIGH** — all five checklist items verified against working implementation in commit `ff55ecf7`.

### Where to make the code changes

- **Explicit registry fail-closed** — `resolveSquad()` in `packages/squad-sdk/src/resolution-v2.ts`. Detect explicit registry with `!!(opts.registryPath ?? opts.env?.['SQUAD_REGISTRY_PATH'])`. In the catch block around registry load/parse, re-throw a `new SquadError('REGISTRY_INVALID', ...)` instead of continuing when the caller declared an authoritative source.

- **Stale path guards for clone/origin matches** — same file, immediately after the `cloneMatches[0]` and `originMatches[0]` path selections. Add `lstatSync` calls wrapped in try/catch that throw `new SquadError('STALE_PATH', ...)` on failure — mirroring the existing pattern at lines 175–184 for callsign resolution.

- **Dispatch-layer error surface** — `cli-entry.ts`, both `start` and `rc` blocks. Wrap `resolveSquadV2()` in try/catch that calls `fatal(err.message)`. After the try/catch, add `existsSync(resolved.path) && statSync(resolved.path).isDirectory()` guard before runner import.

### Fallback-squad fixture for false-positive prevention

Add a second squad fixture in the test's temp directory (e.g., `hostSquad2`) and point `SQUAD_REGISTRY_PATH` at a registry file that references only `hostSquad2`. A malformed-registry test that passes without this fixture may be silently resolving against the cwd squad rather than truly failing closed.

### Test levels required

- **Runner-level** (`vi.doMock` seam): verify bridge/PTY mock not called when resolver throws or path is stale.
- **Dispatch-level** (`runCliShort` subprocess): verify copilot args passthrough filter and that resolver error text appears in process output.


- Does the dispatch layer fail before runner import on null or error resolution?
- Are clone/origin registry matches checked for existing squad directories?
- If an explicit registry path is malformed or unreadable, does the command fail closed instead of falling back?
- Does the test include a fallback squad fixture to prevent false positives from silent fallback?
- Does subprocess spawn use the user-facing CWD rather than the resolved squad directory?
