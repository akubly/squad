---
"@wifi-aware/squad-cli": patch
"@wifi-aware/squad-sdk": patch
---

Restore managed-consumer discovery and wire the squad_state MCP bridge into the consumer clone. The v0.11 managed cold-start dropped the filesystem `local` anchor v0.9 relied on, so registry-aware callers resolved but filesystem-walk discovery (Copilot `.mcp.json` auto-load, agents that grep for `team.md`) broke. Piece 57: cold-start now auto-links the product clone (writes `.squad/config.json` → resolver source=local) and keeps it bound into the managed entry `clones[]`; adds a machine-readable resolver (`squad status --json` plus `squad team-root`/`where` and the SDK `resolveTeamRoot`) so nobody probes for `team.md`; writes a `.mcp.json` whose `squad_state` command resolves to the installed `squad state-mcp` binary instead of an unpublished `npx @insider`; adds a `squad doctor` detect + `--fix` heal for the "resolves-but-no-config-lane" stale managed host; and updates the coordinator agent template to resolve the team root via the resolver, never a `team.md` filesystem search.
