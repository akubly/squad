# Skill: Deprecated Alias Re-Export Pattern

> How to retain a deprecated symbol when canonically renaming a TypeScript export.

## Context

When renaming a public export (e.g., SDK function), callers may have existing code using the old name. The `@deprecated` const alias pattern provides a zero-breaking-change migration path: ship the canonical name in a minor release, remove the deprecated alias in a future major release.

## Pattern

### Simple function or value

```typescript
// canonical name — this is what new code should use
export function resolveSquadDir(startDir?: string): string | null {
  // ...
}

/**
 * @deprecated Use {@link resolveSquadDir} instead.
 * `resolveSquad` will be removed in a future major release.
 */
export const resolveSquad = resolveSquadDir;
```

### Overloaded function (barrel file)

When re-exporting from a barrel that has overloads, use `typeof` to preserve the overload signatures:

```typescript
export function resolveSquadDir(callsign: string): ResolvedSquad | null;
export function resolveSquadDir(options?: ResolveOptions): ResolvedSquad | null;
export function resolveSquadDir(arg?: string | ResolveOptions): ResolvedSquad | null {
  // implementation
}

/**
 * @deprecated Use {@link resolveSquadDir} instead.
 * `resolveSquad` will be removed in a future major release of `@wifi-aware/squad-sdk`.
 */
export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;
```

> **Critical:** Without `typeof`, the alias becomes `(arg?: ...) => ResolvedSquad | null` — a single-overload signature. Callers that rely on the overloads for type narrowing will get incorrect types. Always use `typeof` when the canonical export has overloads.

## Version bump

| Scenario | Bump |
|---|---|
| Add canonical name + `@deprecated` alias (Option A) | `minor` |
| Remove `@deprecated` alias entirely | `major` |
| Rename with no alias (clean break) | `major` |

## Naming conflict check

Before writing import statements, verify that the aliased symbol name does not clash with another import in the same file. In the Squad codebase, both `@wifi-aware/squad-sdk` and `./cli/core/squad-resolver.js` export `resolveSquadDir`. Files that import both MUST alias the SDK import:

```typescript
import { resolveSquadDir as sdkResolveSquadDir } from '@wifi-aware/squad-sdk';
import { resolveSquadDir } from './cli/core/squad-resolver.js';
```

## Where this is used in Squad

- `packages/squad-sdk/src/resolution.ts` — `resolveSquad` deprecated alias for `resolveSquadDir`
- `packages/squad-sdk/src/index.ts` — barrel-level deprecated alias with `typeof` for overload preservation
- Added in piece-25 (commit `e67e0959`), per Brady's Option A decision on D-18
