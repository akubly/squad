# 34 — Client-side publish triggers

## Summary

Add automatic publish triggers so developers do not need to invoke `squad sync --push` manually after every session. Three layered triggers close the ergonomic gap: a git `post-commit` hook in the docs-repo clone (primary, automagic), a Copilot CLI post-tool hook that fires after writes to the team state directory (backup, automagic), and the manual `squad sync --push` command (always available, wired by piece 33). All three triggers operate exclusively from the docs-repo clone; no installation touches the product repo's git configuration or working tree.

Stack position: Part 34 of the cross-repo transport arc. Branches off piece 33 (`squad/piece-33-sync-from-registry`). Depends on piece 33's wired `runSync` push path (`publishTeamRootToInbox`). Piece 35 (fold pipeline) consumes the inbox entries this piece publishes.

## Problem

Piece 33 wires `squad sync --push` as a correct, first-class CLI command, but a workflow that requires explicit manual invocation per session is ergonomically fragile. In a multi-developer concurrent workflow (§9 NFR), developers who forget to invoke the command before ending a session leave stale local state that races with updates from other developers. Two automatic triggers — a git hook and a Copilot CLI post-tool hook — reduce reliance on developer discipline and close the consistency gap at both the git-commit boundary and the session-end boundary.

## Proposed change

### Sub-proposal A — Git post-commit hook in docs-repo clone (primary automagic path)

Extend `install-hooks.ts` to install a `post-commit` hook in the docs-repo clone when invoked with a `--cross-repo` flag (or equivalent option name — implementer judgment on naming, but the semantics are: target a specific external path, not the CWD repo). The hook runs `squad sync --push --quiet` (piece 33's push path). The docs-repo clone path is resolved from the registry: read `docsRepoPath` (or equivalent registry field) from `.squad/config.json`; if absent, the hook install step exits with a clear error directing the user to run `squad bind`.

#### Recursion guard

The `post-commit` hook fires on every commit in the docs-repo clone. `squad sync --push` may itself produce commits (e.g., on the inbox branch before pushing). Without a guard, the hook re-fires after sync's own commit, creating an infinite loop.

Guard mechanism: before running `squad sync --push`, the hook checks the `SQUAD_SYNC_ACTIVE` environment variable. If set to `1`, the hook exits 0 immediately without invoking sync. `squad sync --push` sets `SQUAD_SYNC_ACTIVE=1` in its own environment before performing any commits; the child shell that receives the hook call inherits this variable.

Implementer may additionally or alternatively use a commit-message tag (e.g., `[squad-sync]` in the commit message body) as a secondary guard. If the commit message contains the tag, the hook exits 0 without firing. Both mechanisms are acceptable; the test surface requires that at least the env-var mechanism is demonstrably guarded (see Test surface).

The `SQUAD_SYNC_ACTIVE` guard is already present in the existing hook templates in `install-hooks.ts` (line 37, 53, 75, 95). The post-commit hook must use the same variable so the guard is consistent across all hook types.

#### Hook installation during `squad assign`

Modify `runAssignToCopilot` in `assign.ts` to automatically install the post-commit hook in the resolved docs-repo clone path when `developerAlias` is provided in `RunAssignOpts`. The presence of `developerAlias` is the signal that cross-repo mode is intended. Hook installation should be attempted after the existing coordinator agent install step; if the docs-repo clone path is not yet registered (i.e., `squad bind` has not been run), the step emits a warning and skips gracefully — it does not fail the entire assign command.

A new `installCrossRepoHook(docsRepoPath: string, options: InstallHooksOptions): void` function should be exported from `install-hooks.ts` for use by `assign.ts`. Alternatively, extend the existing `InstallHooksOptions` interface with a `crossRepoPath?: string` field and route through the existing `installGitHooks` entry point — implementer judgment on the cleanest API surface.

### Sub-proposal B — Copilot CLI post-tool hook (backup automagic path)

At execution time, investigate whether the Copilot CLI exposes an external hook registration API for post-tool events (i.e., hooks that fire after a tool write completes, configurable via a file in `~/.config/github-copilot/` or an equivalent location). This is distinct from the SDK-internal `HookPipeline.addPostToolHook` in `packages/squad-sdk/src/hooks/index.ts`, which is an in-process API requiring explicit opt-in by a custom agent — it does not automatically intercept writes from Copilot CLI sessions.

If an external Copilot CLI post-tool hook API exists: register a hook that fires after any tool write to the TEAM_ROOT `.squad/` directory and invokes `squad sync --push --quiet`. The hook should be scoped to writes matching `TEAM_ROOT/.squad/**` to avoid triggering on unrelated file writes.

If no external Copilot CLI post-tool hook API exists: document the gap in `.squad/decisions/inbox/` as a follow-up piece, ship sub-proposals A and C only, and add a `// TODO(piece-34-B): Copilot CLI post-tool hook API not found at implementation time; deferred to follow-up piece` comment at the relevant integration point in `install-hooks.ts` or a new `hooks/copilot-cli-hook.ts` stub file.

The spec does not prescribe the Copilot CLI hook API because it is not verified in this codebase. Sub-proposal B is explicitly execution-time work.

### Sub-proposal C — Manual command quality-of-life

Piece 33 ships `squad sync --push`. This sub-proposal adds three surfaces on top of it:

**`--quiet` flag:** Suppresses informational output from `squad sync --push`. Useful for hook invocation where stdout noise would appear in git output. When `--quiet` is set, only error messages (exit-nonzero paths) are written to stderr.

**`--dry-run` flag:** Shows what would be published without actually pushing. Prints the list of files in TEAM_ROOT that differ from the last successful publish, the target inbox branch name, and the resolved `stateRemote` and `stateBranch` values. Does not invoke `publishTeamRootToInbox`. Useful for debugging before enabling automatic hooks.

**`squad sync status` subcommand:** Prints a structured summary of the current publish state:

```
Last published:    <ISO-8601 timestamp or "never">
Pending changes:   <N files changed in TEAM_ROOT since last publish, or "none">
State remote:      <resolved stateRemote value>
State branch:      <resolved stateBranch value>
Developer alias:   <resolved developerAlias or "(not set)">
Docs repo path:    <resolved docsRepoPath or "(not bound)">
```

The `status` subcommand reads from a local publish-timestamp file (e.g., `.squad/.last-publish`) written by `squad sync --push` on success. If the file is absent, "never" is displayed. The file format is a single ISO-8601 timestamp line; implementer may extend to JSON if additional metadata is needed.

## Special scrutiny

### Hooks install in docs-repo clone only

All hook installation in this piece targets the docs-repo clone's `.git/hooks/` directory. No hook is installed in the product repo. The `--cross-repo` mode of `installGitHooks` (or `installCrossRepoHook`) must accept an explicit `docsRepoPath` argument resolved from the registry. It must not fall back to CWD. If the provided path is not a git repository, exit with a clear error.

This constraint derives from the hard invariant in the cross-repo arc: "No Squad files in product PR diffs." Hook files in `.git/hooks/` are local and not committed, but the install process itself runs in the context of the product repo. The explicit path argument ensures there is no ambiguity about which `.git/hooks/` directory is targeted.

### Recursion guard is non-negotiable

The recursion guard must be demonstrated to work by a test that would produce an infinite loop without it (see Test surface). A guard that is present in the hook template but never exercised by a test is insufficient — the test must confirm that a commit created by `squad sync` itself does not re-trigger the hook.

### SDK `HookPipeline` is not the Copilot CLI post-tool hook

The `HookPipeline` class in `packages/squad-sdk/src/hooks/index.ts` provides a programmatic post-tool-use hook API for custom agents built with the SDK. It is not the same as an external Copilot CLI hook mechanism. Sub-proposal B targets an external, file-based hook API (if one exists) that intercepts tool writes without requiring changes to the agent source code. Do not conflate the two.

### `--quiet` flag must suppress stdout, not stderr

Error messages, including all exit-nonzero paths, must still reach stderr when `--quiet` is set. Silencing errors would make hook invocation failures invisible to the developer.

## Test surface

TDD: write tests to RED before implementation; verify GREEN after.

| Test file | Assertions |
| --- | --- |
| `test/cli/install-hooks.test.ts` (extend) | `installGitHooks` with `--cross-repo` / `crossRepoPath` installs `post-commit` hook in the provided path, not CWD; hook template contains `SQUAD_SYNC_ACTIVE` guard; given a contrived scenario where a commit is made inside a sync invocation, the hook does not re-fire (guard fixture: spawn a shell with `SQUAD_SYNC_ACTIVE=1` set, assert hook body exits 0 without calling sync); `installCrossRepoHook` exits with error when provided path is not a git repo; `installCrossRepoHook` is idempotent (calling twice does not duplicate the hook section) |
| `test/cli/sync-command.test.ts` (extend) | `--quiet` flag suppresses stdout but not stderr; `--dry-run` flag prints pending files and target branch without calling `publishTeamRootToInbox`; `squad sync status` outputs all six fields; `squad sync status` reads `last-publish` timestamp from `.squad/.last-publish` when present; `squad sync status` shows "never" when `.squad/.last-publish` is absent |
| `test/cli/assign.test.ts` (extend) | `runAssignToCopilot` with `developerAlias` set triggers `installCrossRepoHook` call with resolved docs-repo path; `runAssignToCopilot` with `developerAlias` set but docs-repo path absent emits warning and does not throw |
| `test/cli/install-hooks.test.ts` — Copilot CLI hook | If sub-proposal B is implemented: assert hook registration call with correct TEAM_ROOT path scope; if sub-proposal B is deferred (API not found): assert stub comment or gap-doc file is present; document the skip rationale inline in the test file with `// Sub-proposal B deferred: Copilot CLI external post-tool hook API not available at implementation time` |

## Files

| Path | Role |
| --- | --- |
| `packages/squad-cli/src/cli/commands/install-hooks.ts` | Add cross-repo post-commit hook installation; export `installCrossRepoHook`; add sub-proposal B stub or implementation |
| `packages/squad-cli/src/commands/assign.ts` | Call `installCrossRepoHook` when `developerAlias` is present |
| `packages/squad-cli/src/cli/commands/sync.ts` | Add `--quiet`, `--dry-run` flags; add `status` subcommand; write `.squad/.last-publish` on successful push |
| `test/cli/install-hooks.test.ts` | Extend: cross-repo hook install, recursion guard fixture, Copilot CLI hook test or skip |
| `test/cli/sync-command.test.ts` | Extend: `--quiet`, `--dry-run`, `status` subcommand |
| `test/cli/assign.test.ts` | Extend: hook install triggered by `developerAlias` |
| `.changeset/client-side-publish-triggers.md` | patch changeset for `squad-cli` |

## Dependencies

- Branches off piece 33 (`squad/piece-33-sync-from-registry`). Piece 33 must be merged before implementing piece 34.
- Piece 33's `publishTeamRootToInbox` push path is the sync mechanism all three triggers invoke.
- Foundation for piece 35 (fold pipeline), which processes inbox entries produced by the publish triggers wired here.

## Notes

The three-layer trigger model (git hook → Copilot CLI post-tool hook → manual command) is ordered by reliability and developer effort. The git hook is the most reliable path because it fires on every commit regardless of session state. The Copilot CLI hook covers sessions that end without a commit. The manual command is the fallback for controlled or scripted invocations.

The `.squad/.last-publish` timestamp file introduced in sub-proposal C is a light coordination artifact. It enables `squad sync status` and could be extended in future pieces to drive staleness warnings or auto-retry logic.

Sub-proposal B's outcome (implemented vs. gap-documented) must be recorded in `.squad/decisions/inbox/` before the piece is committed. The implementer should not leave the determination implicit — either the hook is registered and tested, or the gap is formally acknowledged as a follow-up piece.

Tone and record discipline applies. No comparison framing, no version leaks, no fork residue.
