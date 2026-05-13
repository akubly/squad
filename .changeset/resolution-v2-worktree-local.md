---
"@bradygaster/squad-sdk": minor
---

Add `resolveSquad()` worktree-local resolution: walks up from CWD to the git root and returns the `.squad/` directory path with `source: 'local'`. Exports `ResolveOpts` and `ResolvedSquad` types via the `./resolution-v2` package subpath.
