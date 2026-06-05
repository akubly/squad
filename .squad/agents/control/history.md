# CONTROL

> Control System Engineer

📌 **Team update (2026-05-19 — Piece 18 Revision Complete):** Piece 18 doctor enhancements (EECOM implementation) revised by CONTROL per adversarial review (F1–F7, N1–N5). All 33 unit tests and 7 CLI-layer subprocess tests pass. CRLF normalization applied to cli-entry.ts. Branch `akubly/upstream-18-doctor-enhancements` force-pushed to `c515745b`.

## Current Session — May 2026

### Piece 25 type-fidelity audit (2026-05-28)

**Verdict: ✅ APPROVE-WITH-NITS** — Commit `e67e0959`.

**N2 (DoctorSource exhaustiveness in `renderFinding`):**
Implemented exactly as directed. Prior code used a ternary (`f.source === 'system' ? ... : ...`) — no exhaustiveness guard. Piece-25 replaced it with an explicit switch: `case 'system':`, `case 'registry':`, `default: { const _exhaustive: never = f.source; throw ... }`. Hypothetical addition of `'workflow'` to `DoctorSource` would cause `Type '"workflow"' is not assignable to type 'never'` at the default arm — compile-time catch confirmed. ✅

**Directive 2 (env seam on CLI `resolveSquadDir`):**
The env seam `(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null` was already present before piece-25 (implemented earlier). Piece-25's only change was updating the import alias from `resolveSquad as resolveSquadV2` → `resolveSquadDir as sdkResolveSquadDir` per D-18 rename. Body uses `sdkResolveSquadDir({ cwd, env })?.path ?? null` — `env` parameter flows through, zero direct `process.env` in body. SDK's `ResolveOpts.env?: Record<string, string|undefined>` accepts `NodeJS.ProcessEnv`. 1-arg callers unaffected. ✅

**Option A alias — two tiers:**
1. `index.ts` (public API): `export const resolveSquad: typeof resolveSquadDir = resolveSquadDir;` — typed const with `typeof`, captures both overloads (`(opts: ResolveOpts): ResolvedSquad | null` and `(startDir?: string): string | null`). Correct form. ✅
2. `resolution.ts` (internal module): `export const resolveSquad = resolveSquadDir;` — bare const, no `typeof`. Single-sig function today so inferred type is correct. **Brittle form** — future overloads on `resolution.ts`'s `resolveSquadDir` would collapse to the impl signature. This module-level alias is NOT re-exported via the barrel, so it does not affect the public API. Non-blocking nit.

**Build gate:** Both `tsc --noEmit -p packages/squad-sdk/tsconfig.json` and `tsc --noEmit -p packages/squad-cli/tsconfig.json` exit 0. ✅

**Suppression sweep (piece-25 delta only):** Zero new `any`, `as`, `!`, `@ts-*`, `eslint-disable` in any piece-25-introduced lines. Pre-existing `eslint-disable-next-line no-constant-condition` in `resolution.ts` (for `while(true)` loops) and `as` casts in `doctor.ts` (JSON parsing) are unrelated to piece-25. ✅

**Meta-learning:** When a directive was already implemented in a prior piece (Directive 2 env seam), the subsequent piece correctly "inherits" that state and only touches the affected import alias — no re-implementation. This is clean. The commit message was transparent about it: "resolveSquadDir in squad-resolver.ts already has the env seam." Future audits should check the prior commit trail if the directive predates the audited piece.

---

### Piece 24 post-implementation: directive fidelity audit (2026-05-27)

**Question:** Did Flight implement CONTROL's 3-overload `_noopStartActiveSpan` directive faithfully?

**Answer: Yes — directive landed exactly as specified. This is rare data.**

Key findings from commit `b1a710fd`:

1. **3-overload form**: All 3 overloads present with correct `F extends (span: OTelSpanLike) => unknown` and `ReturnType<F>` — matches `@opentelemetry/api`'s actual `Tracer.startActiveSpan` shape precisely.

2. **Standalone function**: `_noopStartActiveSpan` is a module-level function declaration (not an inline method literal). Assigned to `_noopTracer.startActiveSpan` by reference. Overload signatures carry over to the method assignment as expected.

3. **ReturnType<F> inference**: All 3 overload signatures return `ReturnType<F>`. Verified that `_noopStartActiveSpan('x', () => 42)` would infer `number` via overload 1.

4. **Implementation body**: `typeof callback !== 'function'` guard used exactly as specified. No `any`, no `as`, no `!`, no `@ts-*`. The `Function` type's implicit `any` return is not "written" — narrowing is clean.

5. **Zero suppressions in new typed surface**: otel-types.ts and new otel-api.ts additions — completely clean. Pre-existing `as const` on `SpanStatusCode` is a const assertion (type narrowing, not widening) and was not introduced by piece-24.

6. **Pre-existing suppressions in client.ts** (`!` at line 133, `as` at lines 485/562/598) — NOT piece-24 additions, not a violation of the spec §9 zero-suppression requirement.

7. **CopilotSessionLike** deviates from spec §2.1 in two places: `send(): Promise<unknown>` (spec said `void`) and an added `destroy(): Promise<void>` (spec omitted it). Both divergences are CORRECT — the real SDK `send()` returns a value; the real session has `destroy()`. Flight correctly over-delivered on spec accuracy.

8. **`options: unknown`** in `OTelTracerLike.startActiveSpan` overloads 2 and 3: intentional, per spec §2.2, to avoid importing OTel types. Slightly weaker than `SpanOptions` but correct for a locally-defined structural interface. This was explicit in the spec revision I reviewed.

9. **D-16 rename**: Complete. Zero `markIdle` occurrences remaining anywhere in `packages/squad-sdk/src/`.

10. **tsconfig**: `strict: true` + `noUncheckedIndexedAccess: true` inherited from root — not weakened by Flight.

11. **Public API**: `OTel*Like` types and `CopilotSessionLike` are NOT exported from the SDK barrel. Correctly internal-only.

12. **Build gate**: `tsc --noEmit -p packages/squad-sdk/tsconfig.json` exits 0 — clean.

**Meta-learning**: Directive-to-implementation fidelity is much higher when the spec is revised to incorporate the directive BEFORE implementation (not handed off as an addendum). The spec rev process (Flight revised §2.2, removed eslint-disable concessions, updated LOC envelope, updated acceptance criteria) created a clean, unambiguous implementation target. The implementer had no design decisions left to make about the noop type design — they just executed the spec. This is the workflow that produces faithful implementations.

---

### Piece 24 pre-implementation: `startActiveSpan` noop typing analysis (2026-05-27)

**Question:** Can the single `eslint-disable-next-line @typescript-eslint/no-explicit-any` concession Flight permitted on `_noopTracer.startActiveSpan` be eliminated entirely?

**Critical context finding:** The ESLint config (`eslint.config.mjs`) does NOT have `@typescript-eslint/no-explicit-any` as an active rule. The existing `/* eslint-disable */` block and all three `// eslint-disable-line` comments in `otel-api.ts` suppress a rule that does not fire. They are dead suppression comments. Piece-24's value is making `_noopTracer: OTelTracerLike` (typed, not `any`) so the compiler verifies shape conformance — the lint cleanup is aesthetic.

**OTel interface structure:** `Tracer.startActiveSpan` in `@opentelemetry/api` is NOT a variadic rest-arg signature. It has exactly THREE distinct overloads:
1. `startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>`
2. `startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>`
3. `startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, context: Context, fn: F): ReturnType<F>`

Flight's proposed `OTelTracerLike` interface uses a variadic generic (`<T>(...args: [string, ...unknown[], (span: OTelSpanLike) => T]): T | undefined`) which is a single-signature approximation. The real OTel API uses 3 concrete overloads — the approximation is inferior.

**Alternatives evaluated:**

- **Alt 1 — 3-overload interface + standalone function (RECOMMENDED):** Redesign `OTelTracerLike.startActiveSpan` from the proposed variadic generic to 3 concrete overloads (mirroring OTel exactly). Define a standalone `_noopStartActiveSpan` function with 4 signatures (3 overloads + 1 implementation). Implementation body uses `typeof callback !== 'function'` guard which narrows `unknown` to `Function` via standard TypeScript narrowing — `Function` is callable, producing implicit (not written) `any`. Zero written `any`, `as`, `!`, or `@ts-*`. Compiles cleanly under `strict: true` + `noUncheckedIndexedAccess: true`. LOC delta: ~+8 over baseline noop object. The redesigned interface is strictly more type-safe than Flight's variadic form: callers get proper `ReturnType<F>` inference, and new OTel overloads require adding an overload to both the interface and the standalone function (detectable at compile time via structural compatibility check).

- **Alt 2 — Callsite narrowing:** Doesn't remove written `any` from the noop definition itself. Not viable for the stated goal (typing the noop object).

- **Alt 3 — `Parameters<Tracer['startActiveSpan']>`:** TypeScript's `Parameters<>` on an overloaded function returns only the last overload's parameter tuple. Cannot union all 3 overloads. Not viable for a clean implementation.

- **Alt 4 — `as OTelTracerLike` at construction site:** `const _noopTracer = { startActiveSpan(name, ...rest: unknown[]) { ... } } as OTelTracerLike`. Uses `unknown[]` (no written `any`) but introduces an `as` cast — a type assertion. Counts as a suppression mechanism even though it's not `eslint-disable`. TypeScript checks structural compatibility through `as` (more safety than `any`), but still a cast. Inferior to Alt 1 which uses none.

- **Alt 5 — OTel's own `NOOP_TRACER`:** Not applicable. The noop exists precisely for when `@opentelemetry/api` is absent at runtime. Cannot depend on OTel's own noop when OTel might not be installed.

**Recommendation:** Alt 1. Redesign `OTelTracerLike.startActiveSpan` from the variadic generic to 3 concrete overloads. This requires a spec revision in piece-24 §2.2 (update the interface definition + add the standalone function pattern). Net LOC impact: ~+8 LOC beyond baseline (well within the 149 LOC headroom). Zero suppression cost of any kind.

**No-active-lint-rule insight:** Brady should know that `@typescript-eslint/no-explicit-any` is not in the ESLint config. Flight's concession in the spec is gesturing at a rule that would never fire. The motivation to avoid written `any` is purely about type-system discipline (which is still the right call), but the "acceptable suppression" framing is slightly misleading — the suppression is already dead code.

---

---

## Archive — Older Learnings (see `history-archive.md` for pre-2026-05-27 full details)

📌 **2026-06-05: Specs 32-35 staged on akubly/upstream-specs (commit 211102b4). New cross-repo arc kickoff is piece 32 (off piece 25.5). Replaces archived pieces 26-31. See upstream specs for design + prompts at _planning/prompts/.**

