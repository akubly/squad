---
"@bradygaster/squad-cli": patch
---

Cross-repo `squad sync --pull` now resolves the state remote and the `squad/state/<callsign>` branch from the registry / team-root host instead of the code clone's origin. The state remote resolves from the entry's `stateRemote`, falling back to the host clone's remote rather than a context-free `origin`; when an entry has no explicit `stateBranch` but carries a callsign, the pull derives `squad/state/<callsign>` (matching the fold pipeline target and what assign/init persist) via the shared `CALLSIGN_RE`, falling back to the flat legacy `squad-state` only when neither is available. A cross-repo pull no longer runs the in-clone fetch against the code clone, so the misleading "no remote squad-state refs found" notice is gone and hydration from the state ref is the sole source.

Cross-repo `squad sync --push` resolves its publish destination the same way: without an explicit `stateRemote` it now publishes to the team-root host's resolved remote rather than a literal `origin`. Host clones whose tracking remote is not named `origin` will publish inbox branches to that remote — set `stateRemote` on the registry entry to pin a specific publish target. `--dry-run --push` now previews the resolved publish remote.
