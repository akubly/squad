# 02 — Worktree-local + callsign resolver

> Stack position: Part 02/20 of the registry-backed resolution and shared-squad command surface stack. Depends on 01 — Registry schema validator.

## Problem

Squad commands need a deterministic way to locate the team root before command-specific behavior runs. The resolver must prefer the current checkout when a `.squad/` directory is present at the git root, and it must also support explicit team selection through a callsign. Missing, ambiguous, or stale callsign references must fail early with actionable errors.

## Proposed change

### API surface

Add a new SDK module at `packages/squad-sdk/src/resolution-v2.ts` and expose it through the `./resolution-v2` package subpath.

```ts
export interface ResolveOpts {
  cwd: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
  callsign?: string;
  registryPath?: string;
}

export interface ResolvedSquad {
  path: string;
  source: 'local' | 'env';
  callsign?: string;
  matchedOrigin?: string | null;
}

export function resolveSquad(opts: ResolveOpts): ResolvedSquad | null;
```

Update `packages/squad-sdk/package.json` with the `./resolution-v2` export and update `packages/squad-sdk/src/index.ts` to re-export `ResolvedSquad` and `ResolveOpts` types from `./resolution-v2.js`.

### Mechanism

`resolveSquad()` validates that `opts.cwd` is a non-empty existing directory before it performs resolution. If `opts.callsign` is provided, the resolver treats it as explicit selection, loads the registry, finds the matching `RegistryEntry.callsign`, verifies that `entry.path` is an existing `.squad/` directory, and returns `{ path, source: 'env', callsign, matchedOrigin: null }`; an empty callsign, missing registry, unknown callsign, or stale path throws `SquadError`.

When no explicit callsign is provided, the resolver walks upward from `opts.cwd` until it finds a `.git` marker. If that git root contains a `.squad/` directory, it returns `{ path: <gitRoot>/.squad, source: 'local', matchedOrigin: null }` without consulting the registry. If the local lookup misses, `SQUAD_CALLSIGN` from `opts.env` or `process.env` is resolved through the same registry lookup path; `opts.registryPath` takes precedence over `opts.env.SQUAD_REGISTRY_PATH`, which takes precedence over the platform default registry path.

## Test surface

| Test name | Assertion |
|-----------|-----------|
| `2.1 returns git-root .squad/ when no callsign and no registry` | A git-root `.squad/` directory resolves with that path. |
| `2.2 returns worktree-local even when registry has a matching origin` | Worktree-local resolution does not read or prefer registry data. |
| `2.3 walks to git-root when CWD is a subdirectory` | Nested working directories resolve to the git root's `.squad/`. |
| `2.4 falls through when no .squad/ found at git-root` | Missing local `.squad/` returns `null` when no later signal is present. |
| `2.5 ignores .squad that is a file rather than a directory` | File-typed `.squad` entries do not resolve. |
| `2.6 resolves when CWD is a subdirectory of the git root` | Subdirectories under the checkout resolve to the root `.squad/`. |
| `Step 2 returns ResolvedSquad with source="local"` | Local results set `source: 'local'`, omit `callsign`, and set `matchedOrigin: null`. |
| `1.1 returns entry path when callsign matches registry entry` | `SQUAD_CALLSIGN` resolves to the matching registry entry path. |
| `1.2 throws SquadError when callsign set but no matching entry` | Unknown callsigns fail instead of falling through. |
| `1.3 throws SquadError when callsign set but registry missing` | Callsign resolution requires a readable registry. |
| `1.4 throws SquadError when callsign resolves but path does not exist on disk` | Stale registry paths fail during resolution. |
| `1.5 worktree-local .squad/ wins over SQUAD_CALLSIGN when both present` | Local checkout resolution has priority over the environment callsign. |
| `1.6 throws SquadError when SQUAD_CALLSIGN is empty string` | Empty environment callsigns are invalid. |
| `Step 1 returns ResolvedSquad with source="env"` | Callsign results include `source: 'env'`, the callsign, and `matchedOrigin: null`. |
| `--callsign flag wins over SQUAD_CALLSIGN env var when both provided` | Explicit callsign selection has priority over the environment variable. |
| `SQUAD_CALLSIGN env var wins over registry-based auto-resolution` | Environment callsign short-circuits later registry auto-resolution steps. |
| `--callsign flag wins over worktree-local .squad/` | Explicit callsign selection has priority over local checkout discovery. |

## Files

| Path | Role | Approx LOC |
|------|------|------------|
| `.changeset/resolution-v2-worktree-local.md` | SDK changeset for worktree-local resolver export | 11 |
| `.changeset/resolution-v2-callsign.md` | SDK changeset for callsign resolution | 10 |
| `packages/squad-sdk/package.json` | Adds `./resolution-v2` package subpath export | 28 |
| `packages/squad-sdk/src/index.ts` | Re-exports resolver types from the SDK barrel | 11 |
| `packages/squad-sdk/src/resolution-v2.ts` | Implements worktree-local and callsign resolution | 250 |
| `test/resolution-v2.test.ts` | Covers resolver priority, fallthrough, and error behavior | 410 |

## Rollback

Remove the `./resolution-v2` package export, delete `packages/squad-sdk/src/resolution-v2.ts`, remove its barrel type exports, and remove `test/resolution-v2.test.ts`. Existing `packages/squad-sdk/src/resolution.ts` behavior remains unchanged.

## Notes for the implementer

Use only the registry API from piece 01 for parsing and validation. Keep the resolver additive so existing callers of `packages/squad-sdk/src/resolution.ts` continue to use the current resolver until command migration pieces opt into `resolution-v2`.
