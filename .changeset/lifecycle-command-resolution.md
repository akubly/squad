---
"@bradygaster/squad-cli": patch
---

Migrate lifecycle commands to shared resolver. `start` and `rc` now resolve the active `.squad/` directory through the v2 registry-backed resolver before bridge, tunnel, PTY, or child-process setup. Passes the resolved path to runners so bridge metadata and roster loading use the correct squad root across shared-squad clones, linked worktrees, and registry callsign selection.
