# Decision: Registry default path — single source of truth

**Author:** EECOM  
**Date:** 2026-05-21  
**Status:** Proposed

## What

The canonical registry file path computation is now in one place:
`packages/squad-sdk/src/path-utils.ts` → `defaultRegistryFilePath(env, homeDir)`.

This helper is exported from the SDK public API and imported by all three previous independent implementations:
- `packages/squad-sdk/src/resolution-v2.ts` (the `resolveSquad` reader chain)
- `packages/squad-cli/src/commands/status.ts` (display-only `resolveStatusRegistryPath`)
- `packages/squad-cli/src/commands/_registry-path.ts` (the writer-side `resolveRegistryFilePath`)

`platformDefaultRegistryPath` (which returned `%APPDATA%\squad\registry.json` on Windows) has been deleted.

## Why

Three independent implementations diverged silently. The bug: `squad assign` wrote `~/.squad/registry.json` and `resolveSquad` read `%APPDATA%\squad\registry.json` on Windows — a different file. The resolver never found the registry and fell through to null; `squad status` showed "none" for an assigned squad.

Single-helper rule: any code that computes a default path for a shared file MUST use the same function as all other code that touches that file. Future authors should grep for `registry.json` before adding a new call site.

## Canonical helper location

`packages/squad-sdk/src/path-utils.ts::defaultRegistryFilePath`  
Exported from `@wifi-aware/squad-sdk` (main barrel).  
Accepts `(env: Record<string, string | undefined>, homeDir?: string)` — pure computation, no I/O.
