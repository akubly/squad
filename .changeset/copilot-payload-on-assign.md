---
"@bradygaster/squad-cli": patch
"@bradygaster/squad-sdk": patch
---

Add Copilot payload install on assign — skills, agents, instructions, and MCP server config are installed into the user-scoped Copilot home on `squad assign`. Adds `--skills-from` option, payload cleanup on `squad unassign`, and orphan detection in `squad doctor`.
