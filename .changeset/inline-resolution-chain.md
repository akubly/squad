---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Squad coordinator now correctly resolves shared squads via `~/.squad/registry.json` on session start. Previously, a CWD-only check at the top of `squad.agent.md` caused the coordinator to jump to Init Mode before consulting the registry chain. The 6-step resolution algorithm is now the very first thing the coordinator runs.
