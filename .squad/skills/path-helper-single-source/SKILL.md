---
name: "path-helper-single-source"
description: "Writer and reader of any shared file path must derive that path from the same helper — never from independent inline logic."
domain: "api-design, error-handling, filesystem"
confidence: "high"
source: "earned"
---

## Context

When two or more code sites independently compute the same default file path, they will diverge. This has happened at least once in this codebase: `squad assign` wrote to `~/.squad/registry.json` while `resolveSquad` read from `%APPDATA%\squad\registry.json` (Windows), causing silent read failures that were invisible until manual smoke testing.

Apply this skill wherever a default path is computed more than once, especially when one site **writes** and another **reads** the same file.

## Patterns

1. **Extract a single helper** that computes the canonical path from minimal inputs (env record + homeDir). Place it in the lowest-dependency module that both sides can import without circular deps (in this codebase: `packages/squad-sdk/src/path-utils.ts`).

2. **Helper signature:** accept env and homeDir as parameters, never read `process.env` or `os.homedir()` directly inside the helper. This makes it deterministically testable.

3. **Export the helper** from the SDK public API so CLI-side modules can import it without duplicating the logic.

4. **Before adding a second call site**, search the codebase first:
   ```
   grep -r "registry.json" packages/ --include="*.ts"
   ```
   If you find an existing caller, reuse its helper rather than writing a new one.

## Examples

`packages/squad-sdk/src/path-utils.ts`:
```typescript
export function defaultRegistryFilePath(
  env: Record<string, string | undefined>,
  homeDir: string = os.homedir(),
): string {
  const squadHome = env['SQUAD_HOME'];
  const base = squadHome ? path.resolve(squadHome) : path.join(homeDir, '.squad');
  return path.join(base, 'registry.json');
}
```

All three consumer sites (`resolution-v2.ts`, `commands/status.ts`, `commands/_registry-path.ts`) import and call this helper rather than re-implementing it.

## Anti-Patterns

- **Inline platform logic** (`if win32 → APPDATA; if darwin → Library/Application Support; else → .config`) duplicated at multiple call sites. This is what caused the original bug.
- **Calling `resolveSquadHome()` from the reader side** when the writer side doesn't — `resolveSquadHome` returns `null` when the directory doesn't exist, silently swallowing the default path.
- **Importing `resolution.ts` from `resolution-v2.ts`** to reuse `resolveSquadHome` — this creates a circular dependency. Use `path-utils.ts` as the shared layer instead.
