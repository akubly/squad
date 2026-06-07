---
'@bradygaster/squad-cli': patch
---

Add automatic publish triggers and QoL sync surfaces

- **Sub-proposal A** — `installCrossRepoHook(docsRepoPath, options?)` exported from `install-hooks.ts` installs a `post-commit` hook in the docs-repo clone that invokes `squad sync --push --quiet` after each commit. Protected by the `SQUAD_SYNC_ACTIVE` recursion guard (same variable used by all existing hooks). Wired into `squad assign` via `runAssign`: when `--developer-alias` is provided, the hook is installed at `path.dirname(registryEntry.path)`; a failure emits a warning and does not abort the assign command.

- **Sub-proposal B** — deferred. Copilot CLI external post-tool hook API not found at implementation time. See `.squad/decisions/inbox/piece-34-B-deferred.md`. A `// TODO(piece-34-B)` stub is present in `install-hooks.ts`.

- **Sub-proposal C** — `--dry-run` flag prints pending `.squad/` files, target inbox branch name, and resolved `stateRemote`/`stateBranch` without invoking `publishTeamRootToInbox`. `squad sync status` subcommand prints six fields (last published, pending changes, state remote, state branch, developer alias, docs repo path). `.squad/.last-publish` is written on successful push (cross-repo and single-repo paths). `--quiet` was already present from the previous piece and is not re-implemented.
