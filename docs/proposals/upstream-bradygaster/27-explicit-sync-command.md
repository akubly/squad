# 27 — Explicit sync command

## Summary

This piece promotes `squad sync` from an unwired internal engine to a supported, documented CLI command. It adds flag-based control over pull, push, hydration, and publication; introduces `ensureStateRemote()` to enforce the docs-remote refspec contract; and updates hook templates so automatic pulls draw from the configured state remote rather than the code remote's origin.

Stack position: Part 27 of the cross-repo transport arc. Depends on Piece 26 (config schema with `stateRemote`, `stateBranch`, `developerAlias`, and the resolved TEAM_ROOT/WORK_ROOT shape must be in place).

## Problem

Three gaps prevent `squad sync` from being usable as a first-class command:

1. `sync` is listed in `KNOWN_UNWIRED` in `test/cli-command-wiring.test.ts`. The underlying `runSync()` / `syncPull()` / `syncPush()` engine in `sync.ts` exists but is not reachable from the CLI dispatch table. Users cannot invoke it.

2. The existing sync engine assumes the current repository's `origin` as the remote. In a cross-repo deployment the state remote is a separate docs/specs repository; the code remote is the product mono-repo. Hooks that call `git pull` against origin pull code, not state.

3. Refspecs for `squad-state` and `squad/inbox/*` are not enforced on the state remote. A developer who manually adds the remote without the correct refspecs will silently receive no state updates on fetch.

## Proposed change

### CLI wiring

Remove `sync` from `KNOWN_UNWIRED`. Add `sync` to the `cli-entry.ts` dispatch table and help block.

### Flags

Add the following flags to the `sync` command:

| Flag | Description |
| --- | --- |
| `--pull` | Fetch from state remote, update TEAM_ROOT, hydrate WORK_ROOT projection |
| `--push` | Publish TEAM_ROOT snapshot to `squad/inbox/<alias>/<session>` |
| `--both` | Equivalent to `--pull` then `--push` |
| `--remote <name>` | Override the state remote name for this invocation |
| `--hydrate-only` | Pull then hydrate only; do not alter git remote config |
| `--publish-only` | Push only; skip pull and hydration |
| `--developer <alias>` | Override the developer alias for this invocation |

Default behavior when no direction flag is given: same as `--both`.

### Remote resolution order

The state remote name is resolved in this order:

1. `--remote <name>` CLI flag.
2. `stateRemote` field in `.squad/config.json`.
3. Hard default: `squad-docs`.

### `ensureStateRemote()` helper

Add `ensureStateRemote(workRoot: string, remoteName: string): Promise<void>` inside `sync.ts`. This helper:

- Reads the current git remote config for WORK_ROOT.
- If the remote is absent, exits with a clear error directing the user to run `squad bind`.
- If the remote is present, confirms the two required refspecs are configured:
  - `+refs/heads/squad-state:refs/remotes/<remote>/squad-state`
  - `+refs/heads/squad/inbox/*:refs/remotes/<remote>/squad/inbox/*`
- For each missing refspec, appends it via `git remote set-url --push` or the equivalent config write. Never removes or overwrites refspecs for unrelated remotes.
- Is idempotent: running twice produces the same config state.

Call `ensureStateRemote()` at the start of every `--pull` and `--push` execution path.

### Hook template updates

Update `post-merge`, `post-checkout`, and `post-rewrite` hook templates in `install-hooks.ts` so they pull from the configured state remote rather than from origin. Specifically:

- Read `stateRemote` from `.squad/config.json` if present; fall back to `squad-docs`.
- Guard the remote pull behind a presence check: if `stateRemote` is absent from `.squad/config.json` (i.e., `squad bind` has not been run), the hook skips the state-fetch step silently without error.
- The existing recursion guard in `install-hooks.ts` must remain intact and must not regress. Verify-first: probe the current guard implementation before modifying any hook code, and confirm the guard path is still triggered after changes.

### Alias-empty guard

If `--developer <alias>` is provided but the value is empty, or if `developerAlias` in config is absent and the command requires a push, exit 1 with a message naming the missing alias and pointing to `squad bind --developer <alias>`.

### Special scrutiny

The hook recursion guard in `install-hooks.ts` is a correctness invariant. Before modifying hook template code, read the guard implementation to confirm it blocks re-entrant hook invocations. After modification, confirm the guard still fires on the same code path. Do not inline remote-pull logic into a hook template in a way that bypasses the guard.

The `--push` flag triggers a write to the docs remote. This is the first CLI surface in the arc where a user action can initiate a remote write. A push must not proceed silently if `squad bind` has not been run; the `ensureStateRemote()` guard handles this.

## Test surface

TDD: write tests to RED before implementation; verify GREEN after.

| Test file | Assertions |
| --- | --- |
| `test/cli/sync-command.test.ts` (new) | `--pull` calls `syncPull()` with correct remote; `--push` calls `syncPush()` with correct remote; `--both` calls pull then push; `--remote` overrides config and default; remote resolution order: CLI flag beats config beats default; `--hydrate-only` skips push path; `--publish-only` skips pull path; `--developer <alias>` passed through to push; empty alias with `--push` exits 1 with error message; `ensureStateRemote()` called before pull and before push; `ensureStateRemote()` exits 1 with bind-guidance message when remote absent; `ensureStateRemote()` appends missing refspecs without removing existing ones; `ensureStateRemote()` is idempotent on repeated calls |
| `test/cli/install-hooks.test.ts` (new) | Recursion guard present in hook template after update; hook templates include state-remote pull with `stateRemote` substituted; hook skips state fetch when `stateRemote` is absent from config; hook chaining from prior hooks remains intact |
| `test/cli-command-wiring.test.ts` (update) | Remove `sync` from `KNOWN_UNWIRED`; assert `sync` is in the dispatch table |

## Files

| Path | Role |
| --- | --- |
| `packages/squad-cli/src/cli-entry.ts` | Remove `sync` from `KNOWN_UNWIRED`; add dispatch entry and help text |
| `packages/squad-cli/src/cli/commands/sync.ts` | Add flag parsing; `ensureStateRemote()`; alias-empty guard; state-remote resolution order |
| `packages/squad-cli/src/cli/commands/install-hooks.ts` | Update hook templates for state-remote pull; preserve recursion guard |
| `test/cli/sync-command.test.ts` | New — all flag and resolution tests |
| `test/cli/install-hooks.test.ts` | New — hook guard and chaining tests |
| `test/cli-command-wiring.test.ts` | Remove `sync` from `KNOWN_UNWIRED` |
| `.changeset/explicit-sync-command.md` | patch changeset for `squad-cli` |

## Notes

`ensureStateRemote()` is the contract boundary between piece 27 and pieces 28–30. Any caller that publishes to or fetches from the state remote must call this helper first. The helper is intentionally small; it does not perform the bind setup itself.

Hook templates that pull from a remote must not silently proceed when the bind config is missing. Silent success on an unconfigured state remote would mean developers on a fresh clone get no state updates without feedback.

Tone and record discipline applies: the state remote is "the docs remote" or "the state remote" — not a comparison to any other remote model.

Rollback is a single-piece revert. The only behavior change visible to users who have not run `squad bind` is that `squad sync` now exits with an actionable error instead of silently succeeding against origin.
