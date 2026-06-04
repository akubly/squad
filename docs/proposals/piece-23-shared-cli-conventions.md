# Proposal: Piece 23 — Shared CLI Conventions

**Author:** Flight (Lead)  
**Date:** 2026-05-22  
**Status:** Draft  
**Scope:** Single PR, four small debt items in one typing-hygiene batch  
**Branch base:** `squad/piece-22-unify-doctors`

---

## Preamble: Item Selection

**Audit source:** `docs/proposals/ship-debt-audit-pieces-1-21.md`

This piece covers the four debt items grouped together as piece 23 in the audit's roadmap table (Decision B in `.squad/decisions.md`): **D-3, D-5, D-11, D-13**. These were explicitly tagged "Suggested Piece: 23" in the audit and cluster under the "typing hygiene + convention decisions" theme. All four fit comfortably under the 200 LOC ceiling (combined: ~50 net production LOC).

**Primary item: D-3** (M-severity) — `hasCodingAgent` extraction. Highest-priority because it fixes a fragile emoji-string heuristic used for Coding Agent detection across four files. The current `content.includes('🤖 Coding Agent')` pattern is copy-pasted at each call site with no shared constant, no regex escape, and a divergent variant in `watch/index.ts` that also checks `@copilot`. If the badge emoji or label changes, four separate edits are required. Extracting this into `squad-file-conventions.ts` follows the pattern already established by FIX-3 (piece 21) for `GITATTRIBUTES_RULES` and `GITIGNORE_ENTRIES`.

**Secondary item: D-5** (M-severity) — `resolveSquadDir` extraction. Three files (`cli-entry.ts`, `config.ts`, `cross-squad.ts`) carry an identical one-liner wrapping the SDK's `resolveSquad`. A fourth file (`economy.ts`) has a divergent manual filesystem walk that should be aligned. Extracting to a shared `cli/core/squad-resolver.ts` prevents future per-command resolver drift.

**Tertiary item: D-11** (S-severity) — `qrcode-terminal` type declarations. Two files (`rc.ts`, `start.ts`) suppress TypeScript errors for the optional `qrcode-terminal` package via `@ts-ignore` / `@ts-expect-error` + `as any` casts. An ambient module declaration eliminates all three suppressions.

**Quaternary item: D-13** (M-severity) — Test seam convention. Three different injection patterns exist across three files. This piece documents the canonical pattern (options-bag seams) as a decision entry so piece 24 doesn't introduce a fourth pattern. No production code change required.

**Items considered and rejected for piece 23:**
- D-6 (adapter `any` typing): SDK adapter layer — piece 24's scope.
- D-7 (resolution.ts while-loop): Absorbed into piece 22.
- D-8, D-9 (OTel `any` typing): SDK runtime — piece 24's scope.
- D-10 (`cli-entry.ts` bootstrap monkeypatch): Won't fix — intentional and documented.
- D-12 (`@internal` on `validateEntry`): Absorbed into piece 22.
- D-14 (span propagation TODO): SDK OTel — piece 24's scope.
- D-15 (workflow stub duplication): Absorbed into piece 22.
- D-16 (`markIdle()` naming): SDK lifecycle — piece 24's scope.
- D-17 (`_rewriteFrontmatterName` test exposure): Won't fix — acceptable.
- D-18 (`resolveSquad` v1/v2 collision): Breaking rename — piece 25's scope.

**Piece 22 collision check:** Piece 22 modifies `cli/commands/doctor.ts` (type unification), `cli-entry.ts` (renderer), and `cli/commands/doctor-types.ts` (new file). Piece 23 touches `cli/commands/doctor.ts` (one inline string check inside `checkGlobalAgent`) and `cli-entry.ts` (one local function removed). Since piece 23 stacks on piece 22's branch, these are clean sequential diffs, not conflicts. The implementation must locate code by function name, not line number, as piece 22 will have shifted line offsets.

---

## 1. Problem Statement

### 1.1 Fragile Agent Detection (D-3)

`hasCopilot()` is exported from `cli/core/team-md.ts` but is not used by all callers. Three files contain inline `content.includes('🤖 Coding Agent')` checks:

- **`cli/core/upgrade.ts`** — `const copilotEnabled = teamContent.includes('🤖 Coding Agent');`  
- **`cli/commands/doctor.ts`** — inside `checkGlobalAgent`: `if (!teamContent.includes('🤖 Coding Agent')) return undefined;`  
- **`cli/commands/watch/index.ts`** — `const hasCopilot = content.includes('🤖 Coding Agent') || content.includes('@copilot');`

The `watch/index.ts` variant is also more comprehensive (checks `@copilot` handle in addition to the badge), creating divergent detection semantics across the codebase. The existing `hasCopilot()` in `team-md.ts` only checks the badge.

Risks from the current state:
1. If the badge glyph changes, four files must be updated, and the divergent `watch/index.ts` check creates a silent inconsistency.
2. `team-md.ts` is imported for its exported `hasCopilot()` but callers of `upgrade.ts` and `doctor.ts` don't use it — they're duplicating the logic without knowing an authoritative version exists.
3. `squad-file-conventions.ts` is the established home for "convention constants that multiple files must agree on" — the Coding Agent detection criterion belongs there.

### 1.2 Duplicated Resolver Wrappers (D-5)

Four files define a local `resolveSquadDir(cwd: string): string | null` function:

- **`cli-entry.ts`** — `return resolveSquadV2({ cwd, env: process.env })?.path ?? null;`
- **`cli/commands/config.ts`** — identical one-liner wrapping `resolveSquadV2`
- **`cli/commands/cross-squad.ts`** — identical one-liner wrapping `resolveSquadV2`
- **`cli/commands/economy.ts`** — divergent: manual 10-level filesystem walk using `FSStorageProvider`

The three SDK-based versions are copy-paste identical. `economy.ts` uses a manual walk that predates (or was written without awareness of) the SDK resolver. Both patterns return the `.squad/` directory path, making the economy.ts walk a behavioral equivalent that adds maintenance surface.

There is no shared utility in `cli/core/` for this operation. Every future command that needs to locate `.squad/` must either copy one of these patterns or invent a fifth.

### 1.3 Optional Dependency Escape Hatches (D-11)

`qrcode-terminal` is an optional runtime dependency. Two files suppress TypeScript errors when importing it:

- **`cli/commands/rc.ts`** — `// @ts-ignore - no type declarations for qrcode-terminal` + `as any` cast
- **`cli/commands/start.ts`** — `// @ts-expect-error — qrcode-terminal is an optional dependency` + `as any` cast

These suppressions mask type errors that should be caught (e.g., wrong property access on the imported module). An ambient module declaration gives the compiler enough information to validate the usage without requiring the package to ship its own types.

### 1.4 Three Injection Patterns, No Convention (D-13)

The codebase has three distinct test-seam injection patterns across three files:

- **`cli/core/upgrade.ts:42–47`** — options-bag seam: `copilotHome?` and `copilotPayloadInstaller?` properties on the options object
- **`assign.ts:270–273`** — SDK-level options-bag: `getGitRoot` and `getRemoteUrls` as injectable overrides
- **`cli/commands/watch/index.ts`** — implicit: no explicit seam; tests that need to control watch behavior must spawn the process

Options-bag seams (the upgrade.ts/assign.ts pattern) are already dominant and are the most ergonomic for TypeScript. But the absence of a documented convention means piece 24 (OTel hardening) may introduce a fourth pattern. This piece captures the decision before it proliferates.

---

## 2. Target Architecture

### 2.1 `hasCodingAgent` in `squad-file-conventions.ts`

**File:** `packages/squad-cli/src/cli/core/squad-file-conventions.ts`

Add after the existing `GITIGNORE_ENTRIES` constant:

```typescript
/** Canonical badge text for the Copilot Coding Agent roster entry. */
export const CODING_AGENT_BADGE = '🤖 Coding Agent';

/**
 * Returns true if the given content (typically team.md) includes a Copilot
 * Coding Agent entry, detected by either the badge or the @copilot handle.
 *
 * Use this instead of inline `content.includes('🤖 Coding Agent')` checks.
 */
export function hasCodingAgent(content: string): boolean {
  return content.includes(CODING_AGENT_BADGE) || content.includes('@copilot');
}
```

`squad-file-conventions.ts` is intentionally dependency-free (node builtins only) — this addition satisfies that constraint: no imports needed.

**Update `team-md.ts`:** `hasCopilot()` becomes a thin re-export calling `hasCodingAgent()`, keeping backward compatibility for any call sites not yet migrated:

```typescript
import { hasCodingAgent } from './squad-file-conventions.js';

/** @deprecated Use hasCodingAgent from squad-file-conventions instead. */
export function hasCopilot(content: string): boolean {
  return hasCodingAgent(content);
}
```

### 2.2 Shared `resolveSquadDir` in `cli/core/squad-resolver.ts`

**New file:** `packages/squad-cli/src/cli/core/squad-resolver.ts`

```typescript
/**
 * Shared Squad directory resolver — wraps the SDK's resolveSquad for CLI use.
 */

import { resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk';

/**
 * Locate the .squad/ directory by walking up from cwd.
 * Returns the absolute path to .squad/ or null if not found.
 *
 * This is the canonical CLI resolver — do not write per-file resolveSquadDir wrappers.
 */
export function resolveSquadDir(cwd: string): string | null {
  return resolveSquadV2({ cwd, env: process.env })?.path ?? null;
}
```

**Why a new file (not detect-squad-dir.ts):** `detect-squad-dir.ts` is marked "zero dependencies" and imports only node:fs/path. Adding an SDK import would violate that constraint. A new file explicitly scoped to the SDK wrapper is cleaner.

**`economy.ts` migration:** Replace the manual 10-level walk with an import of `resolveSquadDir` from the new file. The SDK resolver returns the same `.squad/` path that the manual walk returned, making this a drop-in behavioral replacement. The risk is documented in §6.

### 2.3 `qrcode-terminal` Ambient Declaration

**New file:** `packages/squad-cli/src/types/qrcode-terminal.d.ts`

```typescript
/**
 * Minimal ambient type declaration for the optional qrcode-terminal package.
 * This is intentionally minimal — only the surface used by rc.ts and start.ts.
 */
declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean;
  }
  function generate(text: string, options: QRCodeOptions, callback: (qrcode: string) => void): void;
  export default { generate };
}
```

After adding this file:
- Remove `// @ts-ignore` from `rc.ts` and the `as any` cast on the qrcode import
- Remove `// @ts-expect-error` from `start.ts` and the `as any` cast on the qrcode import

The `tsconfig.json` includes `src/**/*.ts`, so `src/types/qrcode-terminal.d.ts` is picked up automatically.

### 2.4 Options-Bag Seam Convention (D-13)

**No production code change.** Document the canonical pattern as a decision entry (Scribe routes to `.squad/decisions.md`). The convention:

> All injectable test seams in CLI command functions MUST be expressed as optional properties on the function's options object. The property type must match the real function's type exactly (no `any`). The default is the real implementation: `const fn = options.overrideFn ?? realFn;`.

This pattern is already demonstrated by `upgrade.ts`'s `copilotPayloadInstaller` seam and `assign.ts`'s `getGitRoot`/`getRemoteUrls` seams. The convention does NOT require a DI container.

---

## 3. Migration Table

### D-3: Call Sites for `hasCodingAgent`

| File | Current Pattern | After Piece 23 | Notes |
|---|---|---|---|
| `cli/core/team-md.ts` — `hasCopilot()` body | `return content.includes('🤖 Coding Agent');` | `return hasCodingAgent(content);` | Thin wrapper; mark `@deprecated` |
| `cli/core/upgrade.ts` — inside upgrade logic | `teamContent.includes('🤖 Coding Agent')` → `const copilotEnabled` | `hasCodingAgent(teamContent)` | Import `hasCodingAgent` from `squad-file-conventions.js` |
| `cli/commands/doctor.ts` — `checkGlobalAgent` | `!teamContent.includes('🤖 Coding Agent')` | `!hasCodingAgent(teamContent)` | File modified by piece 22; locate by function name `checkGlobalAgent` |
| `cli/commands/watch/index.ts` — `hasCopilot` local | `content.includes('🤖 Coding Agent') \|\| content.includes('@copilot')` | `hasCodingAgent(content)` | New shared function already includes the `@copilot` check |

### D-5: `resolveSquadDir` Usages

| File | Current | After Piece 23 |
|---|---|---|
| `cli-entry.ts` — local `resolveSquadDir` function | Inline wrapper calling `resolveSquadV2` | Remove function; import from `cli/core/squad-resolver.js` |
| `cli/commands/config.ts` — local `resolveSquadDir` function | Inline wrapper calling `resolveSquadV2` | Remove function; import from `cli/core/squad-resolver.js` |
| `cli/commands/cross-squad.ts` — local `resolveSquadDir` function | Inline wrapper calling `resolveSquadV2` | Remove function; import from `cli/core/squad-resolver.js` |
| `cli/commands/economy.ts` — local `resolveSquadDir` function | Manual 10-level filesystem walk | Remove function; import from `cli/core/squad-resolver.js` |

All four files use `resolveSquadDir(cwd)` identically post-import — no call-site changes required after the local function is replaced with the import.

### D-11: Lint Suppressions

| File | Current | After Piece 23 |
|---|---|---|
| `cli/commands/rc.ts` | `// @ts-ignore` + `as any` on qrcode import | Both removed; compiler uses ambient declaration |
| `cli/commands/start.ts` | `// @ts-expect-error` + `as any` on qrcode import | Both removed; compiler uses ambient declaration |

### D-13: Convention Documentation

| Artifact | Current | After Piece 23 |
|---|---|---|
| `.squad/decisions.md` | No entry for test seam convention | Options-bag seam pattern documented (via decisions inbox) |
| `cli/core/upgrade.ts` | Existing seam; no change | No change — already the canonical example |

---

## 4. Consumer / Renderer Changes

No changes to user-facing output or CLI command behavior. This piece is purely internal refactoring:

- `squad doctor` output is unchanged (piece 22 unified the renderer; piece 23 only updates one string check inside `checkGlobalAgent`)
- `squad config`, `squad discover`, `squad delegate`, `squad economy` behaviors are unchanged (resolver output is semantically identical)
- `squad rc` and `squad start` QR code generation behavior is unchanged (type declarations add type safety without behavior change)
- `squad watch` Copilot detection behavior is unchanged (the `@copilot` check is preserved in `hasCodingAgent`)

---

## 5. Test Strategy

### Existing Tests — No Changes Expected

| Test File | What It Tests | Piece 23 Impact |
|---|---|---|
| `test/cli/doctor.test.ts` | Legacy doctor checks including `checkGlobalAgent` | No assertion changes — the finding shape from piece 22 is preserved; only the internal detection condition changes |
| `test/cli/list-doctor.test.ts` | Registry doctor findings | No changes |
| Any test covering `squad config` | Config command resolution | No assertion changes — `resolveSquadDir` output is identical |
| Any test covering `squad economy` | Economy mode toggle | No assertion changes — same `.squad/` path returned |

### New Tests Required

The implementer MUST add these tests before the PR is reviewable:

1. **`hasCodingAgent` unit tests** — new test file `test/cli/squad-file-conventions.test.ts` or add to an existing conventions test:
   - `hasCodingAgent('| @copilot | Coding Agent | — | 🤖 Coding Agent |')` → `true`
   - `hasCodingAgent('content with @copilot mentioned')` → `true`
   - `hasCodingAgent('no agent here')` → `false`
   - `hasCodingAgent('')` → `false`
   - `hasCodingAgent` with only badge → `true`
   - `hasCodingAgent` with only `@copilot` handle → `true`

2. **`resolveSquadDir` shared utility smoke test** — verify the exported function from `squad-resolver.ts` returns the same result as `resolveSquadV2()?.path` for a real directory. This can be a light integration test using the existing test repo fixture that has a `.squad/` directory.

3. **`economy.ts` regression guard** — if there are existing tests for `runEconomy`, verify they still pass with the migrated resolver. If there are no existing economy tests, add one happy-path test: given a CWD with a `.squad/config.json`, `runEconomy(cwd, [])` prints the current mode without error.

4. **`qrcode-terminal` type check** — no runtime test needed; the compiler verifying `rc.ts` and `start.ts` without `@ts-ignore` is sufficient. Verify `npm run build -w packages/squad-cli` passes with suppressions removed.

### What NOT to Test

- Do NOT add tests that duplicate piece 22's doctor test coverage.
- Do NOT add tests for the options-bag seam convention itself — the decision document is the artifact.

---

## 6. Risk + Rollback

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `economy.ts` manual walk has different edge-case behavior vs. SDK resolver | Low | Both return `.squad/` path; SDK resolver handles worktrees (bonus). Test `runEconomy` happy path before committing. |
| `hasCodingAgent` change broadens detection (adds `@copilot` to sites that only checked badge) | Very low | All existing team.md files with a Coding Agent have the badge. The broader check only activates if badge is absent but handle is present — a misconfigured team.md that would have been undetected before. This is a net improvement. |
| `qrcode-terminal` ambient declaration wrong type signature | Low | The only calls are `qrcode.default.generate(url, { small: true }, callback)`. Verify this matches the actual library API (npm page or runtime test). |
| `cli/core/squad-resolver.ts` protected-files policy | Very low | The protected files are bootstrap files in `cli/core/`. Read `.copilot/skills/protected-files/SKILL.md` before creating the new file; verify there is no "zero dependencies" restriction on new files (only on existing annotated files). |
| Piece 22 hasn't merged yet when piece 23 is picked up | High (expected) | Branch from `squad/piece-22-unify-doctors` (not dev). The stacked branch inherits piece 22's changes. |

### Rollback Plan

Single PR revert. The changes are additive (new files: `squad-resolver.ts`, `qrcode-terminal.d.ts`, updated `squad-file-conventions.ts`) plus a small set of call-site updates. Reverting the PR fully restores the pre-piece-23 state. No data migration, no persistence changes, no type removals that would break downstream consumers (all removed functions remain importable from their original locations, just delegating to the new shared versions).

---

## 7. Out of Scope

- ❌ Do NOT add a `codingAgent` field to the team.md schema (audit D-3 says "add team.md schema field in future")
- ❌ Do NOT rename `hasCopilot` to `hasCodingAgent` in `team-md.ts` — keep `hasCopilot` as a deprecated wrapper to avoid breaking any external callers
- ❌ Do NOT migrate `resolveSquadV2` call sites in `cli-entry.ts` that are NOT the local `resolveSquadDir` wrapper (there are additional direct calls to `resolveSquadV2` in `cli-entry.ts` that serve different purposes)
- ❌ Do NOT tackle D-18 (renaming `resolveSquad` v1 to `resolveSquadDir` in the SDK) — that is piece 25 and requires a deprecation strategy
- ❌ Do NOT fix `economy.ts`'s `FSStorageProvider` usage for directory existence checks — only replace the `resolveSquadDir` manual walk; leave other `storage.*` calls as-is
- ❌ Do NOT implement the DI container option from D-13 — options-bag wins, no container
- ❌ Do NOT add new doctor checks or touch any other ship-debt item (D-6 through D-18)
- ❌ Do NOT touch `.changeset/piece-22-unify-doctors.md` — that belongs to piece 22

---

## 8. LOC Budget

**Hard ceiling: 200 production LOC net change (excluding test files).**

Estimated breakdown:
| Change | +LOC | -LOC |
|---|---|---|
| `squad-file-conventions.ts` — add `CODING_AGENT_BADGE` + `hasCodingAgent` | +12 | 0 |
| `team-md.ts` — update `hasCopilot` to delegate + add import | +4 | -2 |
| `upgrade.ts` — replace inline check, add import | +2 | -1 |
| `cli/commands/doctor.ts` — replace inline check in `checkGlobalAgent`, add import | +2 | -1 |
| `cli/commands/watch/index.ts` — replace local `hasCopilot` var, add import | +2 | -1 |
| `cli/core/squad-resolver.ts` — new file | +16 | 0 |
| `cli-entry.ts` — remove local `resolveSquadDir`, add import | +1 | -4 |
| `cli/commands/config.ts` — remove local `resolveSquadDir`, add import | +1 | -4 |
| `cli/commands/cross-squad.ts` — remove local `resolveSquadDir`, add import | +1 | -4 |
| `cli/commands/economy.ts` — remove manual walk (11 lines), add import | +1 | -13 |
| `src/types/qrcode-terminal.d.ts` — new ambient declaration file | +14 | 0 |
| `cli/commands/rc.ts` — remove `@ts-ignore` + `as any` | 0 | -2 |
| `cli/commands/start.ts` — remove `@ts-expect-error` + `as any` | 0 | -2 |
| **Total** | **+56** | **-34** |
| **Net** | **+22 LOC** | |

Expected diff: ~90 gross lines changed, ~22 net. This is the smallest meaningful piece in the 23-batch — a healthy ratio that leaves ample headroom if the implementer discovers any call site missed by this audit.

---

## 9. Acceptance Criteria

The reviewer can tick these boxes independently:

- [ ] `CODING_AGENT_BADGE` constant exported from `packages/squad-cli/src/cli/core/squad-file-conventions.ts`
- [ ] `hasCodingAgent(content: string): boolean` exported from `packages/squad-cli/src/cli/core/squad-file-conventions.ts`
- [ ] `hasCodingAgent` checks both badge (`🤖 Coding Agent`) and handle (`@copilot`)
- [ ] `hasCopilot()` in `team-md.ts` delegates to `hasCodingAgent()` and is marked `@deprecated`
- [ ] No inline `content.includes('🤖 Coding Agent')` checks remain in production source (verify with grep)
- [ ] `packages/squad-cli/src/cli/core/squad-resolver.ts` exists and exports `resolveSquadDir(cwd: string): string | null`
- [ ] No local `resolveSquadDir` function defined in `cli-entry.ts`, `config.ts`, `cross-squad.ts`, or `economy.ts`
- [ ] `economy.ts` imports `resolveSquadDir` from `../core/squad-resolver.js` (no manual walk)
- [ ] `packages/squad-cli/src/types/qrcode-terminal.d.ts` exists with ambient module declaration
- [ ] No `@ts-ignore` or `@ts-expect-error` on qrcode-terminal imports in `rc.ts` or `start.ts`
- [ ] No `as any` casts on the qrcode import in `rc.ts` or `start.ts`
- [ ] Unit tests for `hasCodingAgent` present (badge only, handle only, both, neither)
- [ ] `runEconomy` smoke test passes with migrated resolver (existing or new)
- [ ] `npm run build -w packages/squad-cli` passes clean
- [ ] `npm run lint` passes clean (zero new `eslint-disable` or suppression comments)
- [ ] No new npm dependencies introduced
- [ ] Changeset at `.changeset/piece-23-shared-cli-conventions.md` (patch bump, both packages if touching squad-sdk, else squad-cli only)
- [ ] PR references this proposal and uses commit message format `refactor(cli): extract shared conventions and resolver utilities (piece 23)`
- [ ] Decision entry for options-bag seam convention submitted to `.squad/decisions/inbox/`

---

## References

- Audit: `docs/proposals/ship-debt-audit-pieces-1-21.md` — D-3, D-5, D-11, D-13
- Priority queue: `.squad/decisions.md` — Decision B
- Conventions file: `packages/squad-cli/src/cli/core/squad-file-conventions.ts`
- Detection call sites: `cli/core/team-md.ts` (`hasCopilot`), `cli/core/upgrade.ts`, `cli/commands/doctor.ts` (`checkGlobalAgent`), `cli/commands/watch/index.ts`
- Resolver call sites: `cli-entry.ts`, `cli/commands/config.ts`, `cli/commands/cross-squad.ts`, `cli/commands/economy.ts`
- Optional dep suppressions: `cli/commands/rc.ts`, `cli/commands/start.ts`
- Seam examples: `cli/core/upgrade.ts:42–47` (`copilotPayloadInstaller`), `assign.ts:270–273`
- Piece 22 proposal: `docs/proposals/piece-22-unify-doctors.md`
- Protected files skill: `.copilot/skills/protected-files/SKILL.md`
