# 08c — Migrate lifecycle commands

> Stack position: Part 08c/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 08b — Migrate user-action commands.

## Summary

Piece 08c migrates the `start` and `rc` lifecycle commands to the v2 squad resolution chain. It resolves the active `.squad/` directory before bridge, tunnel, PTY, or child-process setup so long-running sessions use the same cross-clone squad root as the rest of the command surface.

## Problem

The `start` and `rc` lifecycle commands start long-running local processes from the command's current working directory. Today they derive the squad directory by checking only the invocation directory for `.squad/` or `.ai-team/`. That misses shared-squad registrations when the user starts a session from a related clone, a linked worktree, or a directory selected through `SQUAD_CALLSIGN`.

Because these commands keep a bridge, tunnel, child process, or PTY alive after setup, a wrong or missing squad path has a longer impact than a short command failure. The session may start with no roster, an empty squad path in remote metadata, or a Copilot subprocess rooted in the wrong checkout. The lifecycle commands need the same resolver-aware behavior as the rest of the migrated command surface before the next stack pieces build on command-wide resolution consistency.

## Proposed change

Migrate `start` and `rc` to resolve their squad directory through the v2 squad resolution chain before creating long-running process state.

The lifecycle command entry points should:

- Use the shared v2 resolver with the current environment so `SQUAD_REGISTRY_PATH` and `SQUAD_CALLSIGN` behave consistently with the other migrated commands.
- Preserve the existing `--team-root` start-directory override by passing `getSquadStartDir()` into the resolver path.
- For `rc --path <dir>`, treat the explicit path as the command's start directory, then resolve from that directory instead of bypassing resolution.
- Pass the resolved `.squad/` directory to the lifecycle runner when resolution succeeds.
- Keep existing argument parsing and passthrough behavior for `--tunnel`, `--port`, `--command`, and Copilot arguments.
- Keep deprecation notices unchanged.

The shared dispatch helper may be updated if needed so these two lifecycle commands use the same resolution seam as the commands migrated in 08a and 08b.

### Lifecycle-specific behavior

`start` should resolve before `runStart()` verifies optional PTY support or starts the `RemoteBridge`. `rc` should resolve before loading `team.md`, starting the bridge, spawning Copilot, or creating a tunnel. This ordering prevents partially started lifecycle state when the squad cannot be identified.

If resolution returns `null`, the command should print the existing no-squad guidance and return without starting a bridge, tunnel, PTY, or child process. If resolution throws because the registry is unreadable, ambiguous, or stale, the command should surface the resolver error and return before creating long-running state. Mid-flight resolver failures are not expected because resolution happens once at setup time; after the session starts, cleanup remains governed by the existing signal handlers and tunnel cleanup logic.

The resolved path is the `.squad/` directory itself. `start` and `rc` should continue to run the Copilot subprocess from the user-facing start directory so command context remains stable, while bridge metadata and roster loading use the resolved squad path.

## Test surface

| Test | Asserts |
|------|---------|
| `legacy-resolver-migration.test.ts: start resolves shared squad from consumer cwd` | A consumer checkout with no local `.squad/` resolves through registry `clones[]`; `runStart()` reaches bridge setup without calling `process.exit()`. |
| `legacy-resolver-migration.test.ts: rc resolves shared squad from consumer cwd` | A consumer checkout with no local `.squad/` resolves through registry `clones[]`; `runRC()` reaches bridge startup without spawning a real long-lived Copilot process in the fixture directory. |
| `cli-entry lifecycle: start does not start bridge when resolution returns null` | The command prints no-squad guidance and does not call `runStart()`. |
| `cli-entry lifecycle: rc does not start bridge when resolution throws` | Resolver errors are surfaced before `runRC()` is imported or invoked. |
| `cli-entry lifecycle: rc --path resolves from explicit path` | `--path` provides the resolver start directory and still uses the resolved `.squad/` path for roster and bridge metadata. |
| `cli-entry lifecycle: start preserves Copilot passthrough args` | Resolver migration does not consume Copilot arguments that are not Squad flags. |

The two runner-level tests should mock `RemoteBridge`, devtunnel helpers, PTY, and child-process spawning so they validate setup behavior without opening real tunnels or leaving background processes.

## Files

| Path | Role | Approx. LOC |
|------|------|-------------|
| `.changeset/lifecycle-command-resolution.md` | CLI changeset for lifecycle command resolver migration | +5 |
| `packages/squad-cli/src/cli-entry.ts` | Dispatch glue for resolver-aware `start` and `rc` routing | +20 |
| `packages/squad-cli/src/cli/commands/start.ts` | Accept and use resolved squad directory for bridge metadata while preserving process CWD | +12 |
| `packages/squad-cli/src/cli/commands/rc.ts` | Accept and use resolved squad directory for roster loading and bridge metadata | +14 |
| `test/cli/legacy-resolver-migration.test.ts` | Lifecycle command coverage in the command migration test corpus | +90 |

## Rollback

Revert the single commit for this piece. Rollback returns `start` and `rc` to their previous local-directory squad detection and removes the lifecycle tests and changeset. No persisted registry data or session data migration is required.

If rollback happens after users have started sessions through related clones, existing running processes should be stopped normally through Ctrl+C or SIGTERM before reverting the binary. The rollback affects future command startup only; it does not need to mutate bridge audit logs, tunnel state, or registry entries.

## Notes for the implementer

This piece stacks on 08b and completes migration of the eight legacy command groups covered by pieces 08a, 08b, and 08c.

The manifest file count is a union across the command-migration split. Actual replay scope for this piece is limited to lifecycle command files plus shared dispatch glue and the relevant tests. The replay diff should stay below the 30-file gate; if it exceeds the gate, document the reason in the PR description before review.

Follow Microsoft Style Guide tone: use direct, user-focused error text and avoid introducing new branded language. Keep this as forward design: describe the resolver-aware lifecycle behavior to implement, not prior branch history.
