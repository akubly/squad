---
"@bradygaster/squad-cli": patch
---

Harden the state-remote resolver: resolveRemote now resolves the branch-tracking remote, falls back to a sole configured remote or `origin` when present, and fails closed with a clear `stateRemote` error when no remote is determinable. The single-repo code-clone remote keeps its conventional `origin` default, and cross-repo state-remote resolution is deferred so an unrelated code-clone configuration never aborts a sync. Adds real-transport coverage for cross-repo pull (from the derived `squad/state/<callsign>` branch) and push to a non-origin remote.
