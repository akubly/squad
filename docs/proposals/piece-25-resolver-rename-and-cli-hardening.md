# Proposal: Piece 25 — Resolver Rename and CLI Hardening

**Author:** Flight (Lead)  
**Date:** 2026-05-27  
**Status:** Draft  
**Scope:** Single PR, SDK resolver canonical rename (deprecation-only) + two carried-forward CLI hardening items  
**Branch base:** `squad/piece-24-sdk-adapter-otel-typing`

---

## Preamble: Item Selection

**Audit source:** `docs/proposals/ship-debt-audit-pieces-1-21.md`  
**Carried-forward deferrals:** CONTROL's N2 (piece-22 adversarial review) and Directive 2 (piece-23 review), both explicitly targeted at piece 25 in `.squad/decisions.md`.

### Candidates Evaluated

| Source | Item | Severity | Disposition |
|---|---|---|---|
| Audit D-18 | `resolveSquad` v1/v2 dual-export naming confusion in SDK | M | ✅ Selected — primary item |
| Audit D-14 | Span propagation TODO in `tools/index.ts` | M | ❌ Rejected — unmet prerequisite |
| CONTROL N2 (piece-22 review) | `DoctorSource` exhaustiveness gap in `renderFinding` | S | ✅ Selected — near-free with cli-entry.ts open |
| CONTROL Directive 2 (piece-23 review) | `env` injection seam on `resolveSquadDir` in `squad-resolver.ts` | S | ✅ Selected — near-free with squad-resolver.ts open |

### Selected Cluster: D-18 + CONTROL N2 + CONTROL Directive 2

**Primary item: D-18** (M-severity) — Decision B (2026-05-22) assigned `resolveSquad` v1/v2 naming cleanup to piece 25 as the final item in the 22-25 ship-debt wave. The SDK exports a function called `resolveSquad` but `cli-entry.ts:93` imports it aliased as `resolveSquadV2` because the bare name does not signal which version is in use. Piece 23 introduced a CLI-layer wrapper (`resolveSquadDir`) but the SDK's own canonical export name remains ambiguous. The fix: rename the SDK function to `resolveSquadDir` (its actual semantic — "return the path to the `.squad/` directory") and keep `resolveSquad` as a `@deprecated` re-export alias. No consumer loses access to the old name; the compiler steers new code to the canonical name.

**Secondary item: CONTROL N2** (S-severity, deferred from piece-22 revision) — The piece-22 adversarial review found that `renderFinding`/source-grouping in `cli-entry.ts` dispatches over `DoctorSource` without an exhaustiveness guard. If a future piece adds a third `DoctorSource` value (e.g., `'agent'`), new findings would silently disappear from the rendered output. CONTROL deferred this "to follow-up piece per instructions" without naming a specific piece. Since piece 25 opens `cli-entry.ts` to update the `resolveSquadV2` import alias (D-18 CLI side), adding the 3–5 LOC `never`-arm guard is a near-free bundled fix.

**Tertiary item: CONTROL Directive 2** (S-severity, explicitly filed for piece 25) — CONTROL's piece-23 review filed: "Resolver env seam — flag for piece 25." The `resolveSquadDir` function in `cli/core/squad-resolver.ts` hardcodes `process.env`. Adding an optional `env?: NodeJS.ProcessEnv` parameter (defaulting to `process.env`) follows the options-bag seam convention documented in piece 23 (D-13) and makes the function testable without subprocess spawning. Since piece 25 already opens `squad-resolver.ts` to update the SDK import (D-18), this is again near-free.

### Item Rejected: D-14 (Span Propagation)

D-14 (`tools/index.ts` TODO: "Parent span context propagation — tool spans should be children of agent.work spans") was grouped with OTel items in the audit and assigned to piece 24, but piece 24 excluded it: "Feature/implementation work with hidden lifecycle dependency." Piece 24 addressed OTel typing (D-8/D-9) and lifecycle naming (D-16) but did NOT declare agent lifecycle spans "complete" in any formal architectural sense. The prerequisite is still unresolved. D-14 remains implementation/feature work (designing span context propagation, adding `context.with()` calls, modifying runtime trace topology) — potentially 50–100+ LOC requiring new test infrastructure. Deferred until Brady formally declares the lifecycle span design locked.

### Deprecation-Strategy Gate

Decision B originally flagged: "Piece 25 requires a deprecation strategy decision (potential major version bump)." Here is the full analysis:

**What touches the `@bradygaster/squad-sdk` public API:**  
D-18 only. `resolveSquad` is a named SDK export. Any change to this export can affect external consumers.

**Would the selected cluster force a major version bump?**  
**No — under the chosen deprecation approach.** This piece introduces `resolveSquadDir` as a new canonical export name and retains `resolveSquad` as a `@deprecated` re-export alias. The SDK's public API surface only *grows* (one new export added); nothing is removed and no existing signature changes. Semver classification: **minor** bump for `@bradygaster/squad-sdk` (new public export added). The CLI changes (N2, Directive 2) are internal and warrant a **patch** bump for `@bradygaster/squad-cli`.

**What WOULD force a major bump:**  
Removing the `resolveSquad` export from the SDK. This piece explicitly does NOT do that. Removal is deferred to a future major-version cleanup piece that can batch all accumulated `@deprecated` surfaces in one coordinated breaking release.

**Open question for Brady (first item in handoff §Open Questions):** Confirm the minor/patch classification and confirm that deferred removal is acceptable. If Brady wants to absorb the major bump now and remove `resolveSquad` v1 immediately, the implementation work is identical — only the changeset classification and the deprecated alias change (the alias is omitted instead of added). Brady's confirmation is needed before implementation kickoff.

### Why This Cluster Compounds

All three items operate on the resolver surface (SDK naming + CLI wrapper + CLI renderer's source dispatch) that has been touched incrementally since piece 14. Consolidating the naming, the env seam, and the exhaustiveness guard into one piece before new callers proliferate prevents the naming debt from compounding. Total net LOC is ~14 — the smallest piece in the 22-25 wave, appropriate as the final ship-debt cleanup.

---

## 1. Problem Statement

### 1.1 Dual-Export Naming Confusion (D-18)

`packages/squad-sdk/src/resolution.ts` exports a function named `resolveSquad`. Its semantic is "walk up from `cwd` and return the `.squad/` directory path" — a directory-resolution function, not a "squad resolution" function in the broader sense. The name `resolveSquad` does not convey this, causing consumers to alias the import to communicate intent:

- `cli-entry.ts:93` — `import { resolveSquad as resolveSquadV2 } from '@bradygaster/squad-sdk'` — the `V2` suffix signals "this is the registry-aware version, not the old one"
- `cli/core/squad-resolver.ts` (piece 23) — correctly named `resolveSquadDir` at the CLI layer, but imports the SDK function under the alias `resolveSquadV2`
- Any future command file that reaches into the SDK directly must either tolerate the misleading `resolveSquad` name or invent its own alias

The semantic of the function is clear and well-understood: it locates the `.squad/` directory. `resolveSquadDir` is the accurate name — consistent with `resolveSquadDir` already in use at the CLI layer (piece 23), consistent with the `Dir` suffix convention for directory-path resolver utilities, and unambiguous about what the function returns.

### 1.2 Source-Grouping Exhaustiveness Gap (CONTROL N2)

`renderFinding` or the source-grouping block in `cli-entry.ts` (introduced by piece 22's unified renderer) dispatches over `DoctorSource = 'system' | 'registry'`. The current implementation uses `.filter(f => f.source === 'system')` and `.filter(f => f.source === 'registry')` — a pattern that silently discards any finding whose `source` value does not appear in the filter set.

If a future piece adds `'agent'` to `DoctorSource`, findings from the new source would be present in the `findings` array returned by `runUnifiedDoctor` but absent from the rendered output. There would be no compile-time or runtime signal that the renderer is incomplete. CONTROL flagged this in the piece-22 adversarial review, calling for "a switch over `DoctorSource` with a `never` arm." The fix is a compile-time exhaustiveness guard that turns a new source addition into a build error if the renderer is not updated.

### 1.3 Missing `env` Injection Seam (CONTROL Directive 2)

`resolveSquadDir` in `packages/squad-cli/src/cli/core/squad-resolver.ts` hardcodes `process.env`:

```typescript
export function resolveSquadDir(cwd: string): string | null {
  return resolveSquadV2({ cwd, env: process.env })?.path ?? null;
}
```

The options-bag seam convention (D-13, documented in piece 23) requires that test-injectable dependencies be expressed as optional properties on the function's options argument. Here, `process.env` is the injectable dependency: tests that need to verify resolver behavior when `HOME`, `SQUAD_DIR`, or other env vars are set must currently spawn a subprocess or monkeypatch `process.env` globally — both costly and fragile. Adding `env?: NodeJS.ProcessEnv` as an optional second parameter (defaulting to `process.env`) follows the established convention and makes the seam explicit without changing any existing call site.

---

## 2. Target Architecture

### 2.1 SDK: `resolveSquadDir` Canonical Export + `@deprecated` Alias (D-18)

**File:** `packages/squad-sdk/src/resolution.ts`

Rename the exported function from `resolveSquad` to `resolveSquadDir`. Add a deprecated re-export alias to preserve backward compatibility:

```typescript
/**
 * Locate the .squad/ directory by walking up from cwd.
 * Returns the resolution result or null if not found.
 *
 * @param options - { cwd, env? } — the working directory to resolve from and an
 *   optional process environment override (defaults to process.env).
 */
export function resolveSquadDir(options: ResolveOptions): ResolveResult | null {
  // existing implementation body — unchanged
}

/**
 * @deprecated Use {@link resolveSquadDir} instead.
 * resolveSquad will be removed in a future major release of @bradygaster/squad-sdk.
 */
export const resolveSquad = resolveSquadDir;
```

> **Locate by function declaration**, not line number. Grep for `export function resolveSquad` or `export const resolveSquad` in `resolution.ts` to find both the declaration and any barrel re-exports.

This is purely additive:
- `resolveSquadDir` is the new canonical name — identical implementation, new name.
- `resolveSquad` remains exported as a `@deprecated` `const` alias pointing to `resolveSquadDir`. All existing consumers continue to work; their IDE and TypeScript linter will surface the deprecation warning.
- No signature changes. No runtime behavior changes.

**SDK barrel update:** If `packages/squad-sdk/src/index.ts` re-exports `resolveSquad` by name, add `resolveSquadDir` to the same export group. The deprecated `resolveSquad` re-export stays in the barrel until major-version cleanup.

### 2.2 CLI: Update `squad-resolver.ts` Import and Add `env` Seam (D-18 CLI side + Directive 2)

**File:** `packages/squad-cli/src/cli/core/squad-resolver.ts`

Two changes in one edit:

```typescript
import { resolveSquadDir as sdkResolveSquadDir } from '@bradygaster/squad-sdk';

/**
 * Locate the .squad/ directory by walking up from cwd.
 * Returns the absolute path to .squad/ or null if not found.
 *
 * @param cwd - working directory to resolve from
 * @param env - process environment override; defaults to process.env.
 *   Pass a custom env in tests to avoid mutating process.env globally.
 */
export function resolveSquadDir(cwd: string, env?: NodeJS.ProcessEnv): string | null {
  return sdkResolveSquadDir({ cwd, env: env ?? process.env })?.path ?? null;
}
```

**Naming note:** The local export `resolveSquadDir` (CLI wrapper) and the SDK import `resolveSquadDir` would conflict in scope; the import alias `sdkResolveSquadDir` disambiguates them. This is the only file with this naming tension; all external callers of the CLI-layer `resolveSquadDir` are unaffected since the `env` parameter is optional.

**All 4 existing call sites** (`cli-entry.ts`, `config.ts`, `cross-squad.ts`, `economy.ts`) call `resolveSquadDir(cwd)` — the optional `env` parameter changes nothing for them.

### 2.3 CLI: Update `cli-entry.ts` SDK Import (D-18 CLI side)

**File:** `packages/squad-cli/src/cli-entry.ts`

Search for any `import { resolveSquad as resolveSquadV2 }` (or bare `resolveSquad`) in this file. For each occurrence:
- If it is the direct SDK import used for the local `resolveSquadDir` wrapper that piece 23 removed, this import may no longer exist (piece 23 eliminated the local wrapper). Verify by grep before editing.
- If any direct SDK `resolveSquad` import remains, update it to `import { resolveSquadDir } from '@bradygaster/squad-sdk'` and remove the `as resolveSquadV2` alias.

**Locate by content:** `grep -n "resolveSquad" packages/squad-cli/src/cli-entry.ts`

### 2.4 CLI: `renderFinding` Exhaustiveness Guard (CONTROL N2)

**File:** `packages/squad-cli/src/cli-entry.ts`

Locate the `renderFinding` function or the source-grouping block introduced by piece 22. Search for `f.source === 'system'` to find the dispatch site. The current form uses filter-based grouping; add an exhaustiveness guard after all sources are handled.

**Preferred pattern — never-arm helper:**

```typescript
function assertExhaustiveDoctorSource(source: never): never {
  throw new Error(`Unhandled DoctorSource: ${source as string}`);
}
```

Then after the filter-based grouping renders all known sources, add a compile-time gate:

```typescript
// Compile-time exhaustiveness check — fails to build if a new DoctorSource is added
// without updating this renderer.
const _allSources = ['system', 'registry'] as const satisfies readonly DoctorSource[];
void _allSources; // consumed only for type inference
```

Or, if the source dispatch is structured as a per-finding switch inside `renderFinding`:

```typescript
switch (finding.source) {
  case 'system':
    /* ... */
    break;
  case 'registry':
    /* ... */
    break;
  default: {
    const _exhaustive: never = finding.source;
    throw new Error(`Unhandled DoctorSource: ${_exhaustive}`);
  }
}
```

**Implementer's choice:** Use whichever pattern aligns with the current structure of the renderer. The requirement is that adding a new string to `DoctorSource` causes a TypeScript compile error — not that a specific syntactic pattern is used. Prefer the switch form if feasible; the `satisfies` gate form if the renderer is filter-based and refactoring to a switch would exceed the LOC ceiling.

---

## 3. Migration Table

### D-18: SDK Canonical Rename

| Location | Current | After Piece 25 |
|---|---|---|
| `resolution.ts` — function declaration | `export function resolveSquad(options: ResolveOptions): ResolveResult \| null` | Renamed to `resolveSquadDir` (same signature, same body) |
| `resolution.ts` — deprecated alias | *(none)* | `/** @deprecated */ export const resolveSquad = resolveSquadDir;` |
| `packages/squad-sdk/src/index.ts` | `export { resolveSquad }` (if present) | Add `export { resolveSquadDir }` alongside existing `resolveSquad` export |
| `cli/core/squad-resolver.ts` — SDK import | `import { resolveSquad as resolveSquadV2 }` | `import { resolveSquadDir as sdkResolveSquadDir }` |
| `cli-entry.ts` — direct SDK import (if any remain) | `import { resolveSquad as resolveSquadV2 }` | `import { resolveSquadDir }` (no alias needed) |

### CONTROL N2: `renderFinding` Exhaustiveness

| Location | Current | After Piece 25 |
|---|---|---|
| `cli-entry.ts` — `DoctorSource` dispatch | `.filter(f => f.source === 'system')` + `.filter(f => f.source === 'registry')` (no guard) | Same filters + `never`-arm exhaustiveness check that causes a compile error on unhandled source |

### CONTROL Directive 2: `env` Seam

| Location | Current | After Piece 25 |
|---|---|---|
| `cli/core/squad-resolver.ts` — function signature | `resolveSquadDir(cwd: string): string \| null` | `resolveSquadDir(cwd: string, env?: NodeJS.ProcessEnv): string \| null` |
| All 4 call sites (`cli-entry.ts`, `config.ts`, `cross-squad.ts`, `economy.ts`) | `resolveSquadDir(cwd)` | `resolveSquadDir(cwd)` — **unchanged** (optional param; no call site update required) |

---

## 4. Renderer / Consumer Changes

No user-facing output changes. The `renderFinding` exhaustiveness guard (§2.4) only fires if a future piece adds a new `DoctorSource` variant without updating the renderer — it is a compile-time + runtime safety gate, invisible to users under current `'system' | 'registry'` source values.

The `resolveSquadDir` rename in the SDK is compile-time only. All resolver call paths return the same values.

The `env` seam in `squad-resolver.ts` defaults to `process.env` — existing behavior preserved for all production call sites.

---

## 5. Test Strategy

### Existing Tests — No Changes Expected

| Test File | Covers | Piece 25 Impact |
|---|---|---|
| `test/cli/doctor.test.ts` | Doctor findings including source grouping | No assertion changes — finding shapes and renderer output are unchanged |
| `test/cli/list-doctor.test.ts` | Registry doctor findings | No change |
| Any test covering `squad config`, `squad economy`, `squad discover` | Commands using CLI `resolveSquadDir` | No assertion changes — optional `env` param defaults to `process.env` |
| Any test covering `squad-resolver.ts` | Resolver shared utility | Update import alias in test setup if it uses `resolveSquadV2` directly |

### New Tests Required

The implementer MUST add these before the PR is reviewable:

1. **`resolveSquadDir` env seam test (Directive 2)** — in `test/cli/squad-resolver.test.ts` (create if not present):
   - Verify that the `env` parameter is forwarded to the SDK resolver. The cleanest approach: mock `sdkResolveSquadDir` (or use a real `.squad/` fixture) and pass a custom `env` object; assert the result is correct and the env was used rather than `process.env`.
   - Minimum acceptable test: verify `resolveSquadDir(cwd, {})` and `resolveSquadDir(cwd)` both typecheck and return compatible types.

2. **`resolveSquad` deprecated alias backward-compat check (D-18)** — a compile-time check is sufficient:
   - In any existing SDK test file, verify that `import { resolveSquad } from '@bradygaster/squad-sdk'` resolves at compile time (backward compat smoke check). This can be a single `it` block that calls `typeof resolveSquad === 'function'` and asserts true. The meaningful guarantee is that the deprecated alias was not accidentally omitted.
   - Do NOT introduce new `resolveSquad` usages in test code — use `resolveSquadDir` for any new resolver calls.

3. **`renderFinding` exhaustiveness (CONTROL N2)** — this is a compile-time safety guard; the primary "test" is TypeScript itself. Add a verification note in the PR description: "Verified: adding `'agent'` as a third value to `DoctorSource` in `doctor-types.ts` produces a compile error at the exhaustiveness arm." No separate runtime test file needed.

### What NOT to Test

- Do NOT add runtime tests for the `@deprecated` JSDoc annotation itself — deprecation is a documentation/IDE concern, not runtime behavior.
- Do NOT implement D-14 (span propagation) as part of test setup or test scaffolding.
- Do NOT add tests for the `resolveSquad` name removal — the name is not removed in this piece.

---

## 6. Risk + Rollback

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Brady chooses major-bump-now** — i.e., removes `resolveSquad` v1 rather than deprecating it | Medium | Handoff Open Question 1 captures this explicitly. If Brady confirms major-bump-now, add `resolveSquad` removal to §2.1 scope and change SDK changeset to `major`. Implementation work is identical; only the alias line and changeset classification change. |
| `cli-entry.ts` retains `resolveSquad as resolveSquadV2` references not identified in this spec (line numbers shifted post-piece-22) | Low | Implementer MUST grep for `resolveSquad` across `packages/squad-cli/src/` before committing. |
| Import alias collision — both SDK and CLI export `resolveSquadDir`; `squad-resolver.ts` requires `import { resolveSquadDir as sdkResolveSquadDir }` | Low | Documented in §2.2. The alias pattern is conventional for intra-layer disambiguation and is already used in `cli-entry.ts` for other SDK imports. |
| `renderFinding` uses filter-based grouping — exhaustiveness guard is more verbose than a switch default | Low | §2.4 covers both the `satisfies` gate (filter-based) and switch default (switch-based) forms. Either achieves the compile-time guarantee. |
| Piece 24 FIDO nit N3 (Brady sign-off on `getTracer()`/`getMeter()`) may delay piece-24 PR merge, delaying piece-25 branch base availability | Medium | Piece 25 can be specced and the handoff written now; implementation waits until piece-24 PR merges. No spec work is blocked. |

### Deprecation / Semver Risk (explicit)

- `@bradygaster/squad-sdk`: **minor** bump (new `resolveSquadDir` export; deprecated `resolveSquad` alias added — no removal, no signature change).
- `@bradygaster/squad-cli`: **patch** bump (optional `env` parameter addition; `never`-arm render guard — no public API surface change).
- The `resolveSquad` removal (the potential **major** bump) is explicitly out of scope for this piece. A future major-version cleanup piece collects all `@deprecated` surfaces for removal.
- **If Brady confirms major-bump-now:** Change SDK changeset entry from `minor` to `major`. Remove the deprecated alias line in `resolution.ts`. All other implementation work is identical.

### Rollback Plan

Single PR revert. The SDK change is purely additive (new export + deprecated alias). The CLI changes are an optional-parameter addition and a render guard. No data migration; no persistence layer touched; no behavior change for any existing user flow.

---

## 7. Out of Scope

- ❌ Do NOT remove `resolveSquad` from SDK exports — that is the breaking change deferred to a major-version cleanup piece (unless Brady confirms major-bump-now in the Open Questions)
- ❌ Do NOT implement D-14 (span propagation TODO in `tools/index.ts`) — unmet prerequisite, feature work; do not update or close the TODO comment
- ❌ Do NOT add new doctor checks, OTel features, or resolver utilities beyond what is listed
- ❌ Do NOT add `resolveSquadDir` to the `AgentHandle` public interface or any SDK adapter layer
- ❌ Do NOT change any OTel runtime behavior (piece 24 closed that scope)
- ❌ Do NOT tackle the full `DoctorFinding` correlation work (repair commands, per-finding registry correlation) — deferred since piece 22
- ❌ Do NOT add a `codingAgent` field to the team.md schema (deferred in piece 23)
- ❌ Do NOT introduce a DI container or change the options-bag seam convention (D-13 is documented and closed in piece 23)
- ❌ Do NOT touch `packages/squad-sdk/src/tools/index.ts` D-14 TODO comment — do not mark it resolved; it is still deferred

**Items deferred beyond piece 25 (future pieces to pick up):**
- Removal of `resolveSquad` v1 deprecated alias → major-version cleanup piece
- D-14 span propagation → once Brady formally declares agent lifecycle spans locked
- `DoctorFinding.repair` field population → semantic enrichment follow-up to piece 22
- Any new `DoctorSource` values → the exhaustiveness guard added in this piece gates those additions

---

## 8. LOC Budget

**Hard ceiling: 200 production LOC net change (excluding test files).**

Estimated breakdown:

| Change | +LOC | -LOC |
|---|---|---|
| `resolution.ts` — rename function declaration; add `@deprecated` alias + JSDoc (2 lines) | +3 | -1 |
| `packages/squad-sdk/src/index.ts` — add `resolveSquadDir` to barrel export | +1 | 0 |
| `cli/core/squad-resolver.ts` — update import alias; add `env?` parameter + thread to SDK call | +4 | -2 |
| `cli-entry.ts` — update remaining `resolveSquad as resolveSquadV2` import (if any); add exhaustiveness guard helper (~4 lines) | +6 | -2 |
| **Total** | **+14** | **-5** |
| **Net** | **+9–14 LOC** | |

Expected diff: ~35–45 gross lines changed, ~9–14 net. The 186+ LOC of ceiling headroom is intentional — this is the final ship-debt cleanup piece in the 22-25 wave and scope is deliberately tight. If the exhaustiveness guard requires a switch refactor of the renderer, budget an additional ~10–15 LOC net; still well under ceiling.

---

## 9. Acceptance Criteria

The reviewer can tick these boxes independently:

- [ ] `packages/squad-sdk/src/resolution.ts` exports `resolveSquadDir` as a named function (same implementation as former `resolveSquad`)
- [ ] `resolveSquad` is still exported from `resolution.ts` with a `@deprecated` JSDoc annotation pointing to `resolveSquadDir`
- [ ] `packages/squad-sdk/src/index.ts` (SDK barrel) exports `resolveSquadDir`
- [ ] `cli/core/squad-resolver.ts` imports the SDK function using `resolveSquadDir` (no `resolveSquad as resolveSquadV2` alias)
- [ ] `resolveSquadDir` in `squad-resolver.ts` accepts an optional `env?: NodeJS.ProcessEnv` second parameter
- [ ] All 4 existing call sites (`cli-entry.ts`, `config.ts`, `cross-squad.ts`, `economy.ts`) call `resolveSquadDir(cwd)` unchanged — no call site update required
- [ ] `grep -rn "resolveSquad as resolveSquadV2" packages/` returns zero results
- [ ] `renderFinding`/source-grouping in `cli-entry.ts` has a `never`-arm or `satisfies`-based exhaustiveness guard for `DoctorSource`
- [ ] Adding a third value to `DoctorSource` in `doctor-types.ts` causes a TypeScript compile error at the exhaustiveness arm (verified by author and noted in PR)
- [ ] `env` seam test added for `resolveSquadDir`: verifies the `env` parameter is forwarded to the SDK resolver
- [ ] Deprecated `resolveSquad` alias is still callable at runtime (backward compat — verified by test or noted in PR)
- [ ] `npm run build` passes clean (both packages)
- [ ] `npm run lint` passes clean (zero new `eslint-disable` or `@ts-*`)
- [ ] Net production LOC change ≤50 (verify with `git diff --stat`)
- [ ] `.changeset/piece-25-resolver-rename-and-cli-hardening.md` present with `minor` bump for `@bradygaster/squad-sdk` and `patch` for `@bradygaster/squad-cli` (or `major`/`patch` if Brady confirms major-bump-now)
- [ ] PR references `docs/proposals/piece-25-resolver-rename-and-cli-hardening.md`

---

## References

- Audit D-18: `docs/proposals/ship-debt-audit-pieces-1-21.md` ("Legacy `resolveSquad` (v1) still exported — consumers must alias `resolveSquadV2`")
- Audit D-14: `docs/proposals/ship-debt-audit-pieces-1-21.md` ("Deferred span propagation — implement when agent lifecycle spans are complete")
- CONTROL N2: `.squad/decisions.md` — piece-22 adversarial review ("Directive 2: `DoctorSource` grouping needs exhaustiveness assertion or Map-based dispatch")
- CONTROL Directive 2: `.squad/decisions.md` — piece-24 spec preamble ("Directive 2 — Resolver env seam (flag for piece 25)")
- Decision B priority queue: `.squad/decisions.md` → "4 | 25 | SDK naming cleanup (breaking) | D-18"
- CLI resolver wrapper: `packages/squad-cli/src/cli/core/squad-resolver.ts` (introduced piece 23)
- Doctor types: `packages/squad-cli/src/cli/commands/doctor-types.ts` (introduced piece 22)
- Options-bag seam convention: `.squad/decisions.md` — options-bag seam decision (piece 23, D-13)
- Piece 24 out-of-scope note: `docs/proposals/piece-24-sdk-adapter-otel-typing.md §7` ("Do NOT tackle D-18")
- Piece 24 preamble: "CONTROL's Directive 2 (resolver env seam): explicitly filed for piece 25"
