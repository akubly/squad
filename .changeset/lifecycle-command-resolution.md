---
"@bradygaster/squad-cli": patch
---

Migrate lifecycle commands to shared resolver with fail-closed path validation. `start` and `rc` now resolve the active `.squad/` directory through the v2 registry-backed resolver before bridge, tunnel, PTY, or child-process setup. Malformed or explicitly-supplied registries fail closed with a clear error before any long-running state is created. Resolved paths are validated as existing directories before runners are invoked, preventing stale registry entries from starting sessions with incorrect squad metadata. Passes the resolved path to runners so bridge metadata and roster loading use the correct squad root across shared-squad clones, linked worktrees, and registry callsign selection.
