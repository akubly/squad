# 26 — Cross-repo bind config

## Summary

This piece normalizes the TEAM_ROOT/WORK_ROOT separation in the config schema and resolver, then adds the `squad bind` command that wires up a cross-repo deployment from scratch. The config schema expansion and `runBind()` implementation ship as a single session with their tests. Pieces 27–30 depend on the schema contract locked here.

Stack position: Part 26 of the cross-repo transport arc. Depends on nothing in this arc. All other pieces in the arc (27–30) depend on this piece.

## Problem

`resolveSquadPaths()` conflates "repo root" and ".squad directory" semantics. The returned shape uses `projectDir` and `teamDir` as the only root-level locators, neither of which maps unambiguously to WORK_ROOT (the product repo) versus TEAM_ROOT (the docs/specs sidecar). Callers infer which root applies from context, which breaks down once the two roots live on different drives or in different repositories.

Three concrete gaps:

- No config field names a secondary state remote or its branch; every piece that needs `stateRemote` or `stateBranch` is blocked until these fields are defined.
- No dedicated `workRoot` / `workSquadDir` / `teamRoot` / `teamSquadDir` in the resolved shape; pieces 27–30 would have to re-derive these from `projectDir` with hand-written heuristics.
- No `squad bind` command exists; the only setup path is `squad init` plus manual remote configuration, which leaves WORK_ROOT `.git/info/exclude` and hook templates unconfigured for cross-repo mode.

## Proposed change

### Config schema — `SquadDirConfig` additions

Add six optional fields to `SquadDirConfig` in `packages/squad-sdk/src/resolution.ts`:

| Field | Type | Default |
| --- | --- | --- |
| `stateRemote` | `string` | `squad-docs` |
| `stateBranch` | `string` | `squad-state` |
| `inboxBranchPrefix` | `string` | `squad/inbox` |
| `developerAlias` | `string` | — |
| `teamCachePath` | `string` | — |
| `hydrateWorkRoot` | `boolean` | — |

`teamCachePath` is the absolute sidecar clone path when it differs from `teamRoot` (required when the sidecar lives on a different drive from WORK_ROOT).

### Resolved shape additions

Add four fields to the object returned by `resolveSquadPaths()`:

| Field | Description |
| --- | --- |
| `workRoot` | Absolute path to the product repo root |
| `workSquadDir` | `{workRoot}/.squad` — projection only; not a canonical state root |
| `teamRoot` | Absolute path to the docs/specs sidecar clone |
| `teamSquadDir` | `{teamRoot}/.squad` — the canonical writable state root |

### Deprecated aliases

Keep `projectDir` and `teamDir` as deprecated aliases on the resolved shape for one release. Annotate with `@deprecated` JSDoc pointing to `workRoot` and `teamRoot` respectively. On first access, emit a `console.warn` once per process via a flag guard. The removal is planned for the next minor version after this arc ships.

### `runBind()` — seven sub-steps

Add `runBind(opts: BindOptions): Promise<void>` to `packages/squad-cli/src/cli/commands/bind.ts`. The function performs all setup atomically:

1. Clone or fetch the docs/specs repo into the sidecar path (`teamCachePath` or a platform-appropriate default under the user data directory).
2. Write `WORK_ROOT/.squad/config.json` with `stateRemote`, `stateBranch`, `inboxBranchPrefix`, `developerAlias`, and `hydrateWorkRoot`.
3. Add the `squad-docs` remote in WORK_ROOT via `git remote add` if not present; skip silently if already present (idempotent).
4. Set fetch refspecs for `+refs/heads/squad-state:refs/remotes/<remote>/squad-state` and `+refs/heads/squad/inbox/*:refs/remotes/<remote>/squad/inbox/*` on the docs remote.
5. Append `.squad/` and `.github/agents/*` to `WORK_ROOT/.git/info/exclude`. Use an idempotent append: read existing content, skip the entry if already present, never overwrite. Windows cross-drive paths must be written as forward-slash relative patterns, not absolute paths.
6. Install or update the sync hook templates (`post-merge`, `post-checkout`, `post-rewrite`) using the existing hook installer in `install-hooks.ts`.
7. Run an initial `squad sync --pull` to hydrate TEAM_ROOT and, if `hydrateWorkRoot` is true, the ignored projection in WORK_ROOT.

Wire `bind` into `packages/squad-cli/src/cli-entry.ts` help and dispatch.

### Special scrutiny

`runBind()` step 5 writes to `.git/info/exclude`. This is a new write surface on the developer's WORK_ROOT. Requirements:
- Never overwrite existing content; always append.
- Read the file before writing; if the exact entry is already present, do nothing.
- Normalize the entry as a forward-slash pattern regardless of host OS, so the exclude rule works on all platforms.
- On Windows, when WORK_ROOT and TEAM_ROOT are on different drives, do not write an absolute path — write a repo-relative pattern.

## Test surface

TDD: write tests to RED before implementation; verify GREEN after.

| Test file | Assertions |
| --- | --- |
| `test/cli/bind.test.ts` (new) | Config written with correct fields; `git remote add` runs when remote absent; remote add skipped when already present (idempotent); refspecs set correctly for `squad-state` and `squad/inbox/*`; exclude file gets entries appended; exclude file is not overwritten when entries already present; hook templates installed; re-running `runBind()` on an already-configured WORK_ROOT is a no-op (full idempotency); Windows cross-drive path does not appear as absolute in exclude entry |
| `test/cli/init-remote.test.ts` (update) | Update for new resolved shape (`workRoot`, `teamRoot`, `workSquadDir`, `teamSquadDir`); verify deprecated `projectDir`/`teamDir` aliases still return correct values with a `console.warn` side effect |
| `test/cli-command-wiring.test.ts` (update) | Assert `bind` is present in the CLI dispatch table |
| `test/cli-packaging-smoke.test.ts` (update) | Assert `squad bind --help` exits 0 |
| Resolver tests (update) | Deprecated alias `projectDir` fires `console.warn` exactly once per process even if accessed multiple times; `teamDir` same |

## Files

| Path | Role |
| --- | --- |
| `packages/squad-sdk/src/resolution.ts` | `SquadDirConfig` field additions; resolved shape additions; deprecated alias wrappers |
| `packages/squad-cli/src/cli/commands/bind.ts` | New — `runBind()` and `BindOptions` |
| `packages/squad-cli/src/cli-entry.ts` | Wire `bind` into help and dispatch |
| `test/cli/bind.test.ts` | New — all `runBind()` assertions |
| `test/cli/init-remote.test.ts` | Update for new shape |
| `test/cli-command-wiring.test.ts` | Add `bind` assertion |
| `test/cli-packaging-smoke.test.ts` | Add `bind` smoke assertion |
| `.changeset/cross-repo-bind-config.md` | minor changeset for `squad-sdk` (new fields), patch for `squad-cli` (new command) |

## Notes

Schema correctness is the foundational contract for this arc. Any breaking change to `SquadDirConfig` or the resolved shape after this piece ships will cascade to pieces 27–30. The `@deprecated` wrappers on `projectDir`/`teamDir` exist to protect callers that already consume the resolved shape; they must not be removed in this piece.

Tone and record discipline applies: describe the bind command and config expansion as "the cross-repo bind config" surface. Do not use comparison framing.

Rollback is a single-piece revert. No user data migration is required — the new config fields are optional and their absence is handled gracefully by all callers.
