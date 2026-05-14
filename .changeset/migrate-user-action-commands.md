---
"@bradygaster/squad-cli": patch
---

Migrate user-action commands to shared resolver. `consult` setup and `link` now call `resolveSquad()` as a precondition before writing project files, ensuring no side effects occur when no squad context is available. Adds `assign-to-copilot` command that registers the current directory as a clone of a resolved squad.
