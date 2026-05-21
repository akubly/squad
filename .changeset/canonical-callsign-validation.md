---
"@bradygaster/squad-sdk": minor
"@bradygaster/squad-cli": minor
---

Callsign validation tightened: lowercase + digits + internal hyphens only. Callsigns using uppercase letters, underscores, or periods will now be rejected. Rename existing entries via `squad assign --callsign <new-name>` or by manually editing `~/.squad/registry.json`.
