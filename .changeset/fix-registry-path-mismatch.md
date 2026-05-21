---
"@wifi-aware/squad-sdk": patch
"@wifi-aware/squad-cli": patch
---

Fix `squad status` not resolving squads assigned via `~/.squad/registry.json`. The default registry path read by `resolveSquad` now matches the path written by `squad assign` (`~/.squad/registry.json`), eliminating the platform-divergent `%APPDATA%\squad\registry.json` / `~/Library/Application Support/squad/` mismatch.

A new `defaultRegistryFilePath(env, homeDir)` helper in `packages/squad-sdk/src/path-utils.ts` is the single source of truth for the default registry path. All three previous independent implementations (`resolution-v2.ts`, `commands/status.ts`, `commands/_registry-path.ts`) now delegate to this helper.
