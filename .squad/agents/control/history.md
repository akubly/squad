# CONTROL

> Control System Engineer

📌 **Team update (2026-05-19 — Piece 18 Revision Complete):** Piece 18 doctor enhancements (EECOM implementation) revised by CONTROL per adversarial review (F1–F7, N1–N5). All 33 unit tests and 7 CLI-layer subprocess tests pass. CRLF normalization applied to cli-entry.ts. Branch `akubly/upstream-18-doctor-enhancements` force-pushed to `c515745b`.

## Current Session — Learnings & Archive

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

## Archive — Summary (see `history-archive.md` for full pre-2026-05-27 learnings)

### Piece 23 adversarial type review — shared CLI conventions (2026-05-27)

- **`export default { generate }` in ambient `declare module` is non-idiomatic but compiles.** Both object-literal and const forms satisfy caller's access pattern. Reserve nit for future revision.
- **`resolveSquadDir` hardcodes `process.env` — no injectable seam.** Consistent with spec; conflicts with D-13 options-bag convention. Consider overload in piece 25.
- **`string | null` return on shared utility is correct.** Widely understood pattern; all callsites guard; `?.` chaining satisfies `noUncheckedIndexedAccess`.
- **Barrel hygiene matters at `cli/index.ts`.** `squad-resolver.ts` is internal-only. Accidental `export *` additions become public API with semver implications.

### Piece 22 adversarial type-design review — doctor unification (2026-05-22)

- **Exit-code derivation must use `never`-guarded helper, not inline `.filter()`.** Switch on `DoctorSeverity` has correct `never` arm; exit-code block uses open string comparison with no exhaustiveness guard.
- **`DoctorSource` grouping in renderer has no exhaustiveness guard.** `.filter()` splits by source; third source value silently never renders.
- **Public types on barrel are public API — semver implications.** `DoctorFinding`, `DoctorSeverity`, `DoctorSource`, `DoctorRepair` re-exported from barrel; any breaking change requires semver bump.
- **Two canonical import paths for same types.** `cli-entry.ts` imports `DoctorFinding` directly, bypassing barrel. Convention is to import from barrel to avoid future move refactors.
- **`DoctorFinding` fields should be `readonly`.** Represents value objects; immutability prevents mutation bugs.

### Piece 18 adversarial revision — doctor enhancements (2026-05-19)

- **`loadRegistryFromDisk` throws on corrupt JSON; don't assume null return.** Throws `SquadError` on invalid JSON; callers need try/catch for null-safe handling.
- **`git add --renormalize` is required for CRLF normalization.** `core.autocrlf=true` alone does not normalize pre-committed CRLF files; must use `--renormalize`.
- **Async `promptFn` pattern prevents readline blocking in tests.** Replace `readLine?: () => string` with `promptFn?: (question: string) => Promise<string>` for non-blocking mocks.
- **CLI-layer subprocess tests require current build.** Tests spawning `dist/cli-entry.js` must run after `npm run build` to avoid stale binary execution.

### Piece 14 revision — TypeScript patterns (2026-05-18)

- **Error codes as message prefixes are anti-pattern.** All `ERR_ASSIGN_*` codes embedded in message string; no `.code` property. Future commands should use typed error code union.
- **`--key=value` arg parsing must be explicitly handled.** `args.indexOf('--flag')` silently ignores `=`-delimited form. Shared arg-value helper needed.
- **Discriminated unions need `never` guards in switches.** Missing `default: { const _: never = x; }` silently misses new variants at compile time.
- **`RegistryEntry [key: string]: unknown` is safer than feared.** Named properties take precedence; index signature only affects bracket-form reads.
- **`noUncheckedIndexedAccess` compliance throughout.** All array index reads in piece 14 use `!` correctly. Zero tsc errors.

### Piece 16 URL guard revision (2026-05-18)

- **CLI URL guards must scan every candidate token, not just first positional.** Skip only recognized option values; URL can hide after value-taking flags.
- **Init URL detection should normalize before matching.** Trim token first, then match protocols; preserve Windows, UNC, local relative paths.
- **Tone & Record scrubs preserve facts and counts while dropping attribution.** Remove author lines, verdict labels, breadcrumbs; keep behavior, evidence, outcome.

### Piece 08a & 09 revisions — resolver migration (2026-05-15)

- **Routed `squad init` through one validation module** for scaffold, callsign, clone path, registry-source checks before writes.
- **Added `.squad` symbolic-link detection** with `lstatSync` to prevent redirect escapes.
- **Moved watch startup resolver to internal module** so command declarations stay focused on supported APIs.
- **Command-surface parity tests** should invoke `runWatch()` and `runTriage()` with platform, auth, monitor, capability seams stubbed.

  2. **Blocker 2 (cross-source escalation test):** Added `renderFinding + deriveExitCode` describe block with two tests — cross-source (system warn + registry error → exit 2, both on stderr) and info-on-stdout companion.
  3. **N1 (exhaustive exit-code helper):** `deriveExitCode(findings: readonly DoctorFinding[]): 0 | 2` exported from `doctor.ts` with exhaustive severity switch + `never` arm. `cli-entry.ts` now destructures it from the dynamic import and uses it instead of `if (errorCount > 0)`.
  4. **N3 (readonly fields):** All `DoctorFinding` fields marked `readonly`.
  5. **N4 (import alignment):** Static `DoctorFinding` import from `doctor-types.js` removed from `cli-entry.ts`; `renderFinding`/`deriveExitCode` destructured from the existing dynamic import of `doctor.js`.

- **LOC count:** Flight's commit ~111 net production + my rev +29 net production = **~140 net total**. Under the 200-LOC ceiling.
- **Optional cleanups folded in:** N3 (readonly), N4 (import alignment). N2 (source-grouping exhaustiveness) deferred per instructions.
- **Spec contradiction encountered:** Comment at `cli-entry.ts:1101` read "Warnings go to stderr" but `_renderFinding` used `console.log` for all findings. After fix, comment and code now agree.
- **Build:** CLEAN. **Lint:** CLEAN. **Doctor tests:** 46/46 GREEN.

---

## Piece 24 Type-Design Fidelity Audit (2026-05-27T16:00Z)

**Verdict:** ✅ APPROVE

**All directive criteria pass. All 19 spec §9 acceptance criteria verified.**

**Directive fidelity checklist:**
- 3-overload form implemented faithfully ✅
- Standalone function (not inline method) ✅
- `ReturnType<F>` inference preserved ✅
- Zero suppressions in typed surface ✅

**Key technical findings:**

**3-Overload Implementation — Exact Match.**  
`_noopStartActiveSpan` (lines 43–50 of `otel-api.ts`) matches `@opentelemetry/api`'s real `Tracer.startActiveSpan` shape precisely. All 3 overloads present with correct `F extends (span: OTelSpanLike) => unknown` generic and `ReturnType<F>` return type.

**Standalone Function Pattern — Correct.**  
Function declared at module level (not inline method). Assigned to `_noopTracer.startActiveSpan` by reference. Overload signatures attach to the function declaration as expected; they carry over to method assignment semantics.

**Callback Resolution — Type-Safe.**  
Implementation uses `typeof callback !== 'function'` guard to cascade through three callback positions (depends on arity). The `Function` type is callable; return type is implicitly `any` (not written). No `any`, `as`, `!`, or `@ts-*` in the surface.

**Zero Suppressions — Verified by Grep.**  
`otel-types.ts` (new) and new additions to `otel-api.ts` and `adapter/client.ts`: zero `any`, `as`, `!`, `eslint-disable`, `@ts-*`. Pre-existing `as const` on `SpanStatusCode` in old code is a const assertion (type narrowing), not a type cast, and predates piece-24.

**Type nits (non-blocking, all represent improvements over spec):**

- **N1:** `CopilotSessionLike.send()` returns `Promise<unknown>` (spec said `void`). Implementation is MORE correct — the real SDK `send()` returns a value. Additionally, `destroy(): Promise<void>` was added (spec omitted). Both divergences increase API accuracy.

- **N2:** `options: unknown` in `startActiveSpan` overloads 2 and 3 (spec said concrete `SpanOptions`). Intentional per spec §2.2 to preserve zero-OTel-import invariant. Acceptable structural typing trade.

- **N3:** `OTelDiagLoggerLike` interface split added beyond spec §2.2. Spec suggested single `OTelDiagLike`; implementation correctly separated `DiagLogger` (instance interface: 5 log methods) from `DiagAPI` (singleton: adds `setLogger`/`disable`). This split is structurally correct and makes the type system more honest about the real OTel API shape.

**CopilotSessionLike Shape — Real, Not Placeholder.**  
Verified against all 6 real access points in `CopilotSessionAdapter`: `sessionId?`, `send()`, `sendAndWait()`, `abort()`, `getMessages()`, `destroy()`, `on()`. Compiler enforces all 6. Real type safety, not cosmetic.

**tsconfig Integrity — No Relaxation.**  
`strict: true` + `noUncheckedIndexedAccess: true` inherited from root; no relaxations added by Flight.

**Gate Results — All Clean.**  
- `tsc --noEmit -p packages/squad-sdk/tsconfig.json` → exit 0
- `npm run build -w packages/squad-sdk` → clean
- `npm run lint` → clean
- `npx vitest run` → 88-test suite (scoped) all pass

**Meta-learning (reinforced & documented for future team use):**

Directive-to-implementation fidelity is much higher when the spec is revised to incorporate the directive BEFORE implementation kickoff, not handed off as an addendum. Here's what works:

1. **Directive phase** — TypeScript engineer (CONTROL) analyzes problem, proposes solution (3-overload form, standalone function, type-narrowing implementation body).
2. **Spec revision phase** — Lead (Flight) revises spec §2.2 to incorporate the directive before sending piece to implementer. Updates LOC envelope, updates acceptance criteria §9, removes fallback language (like "acceptable eslint-disable").
3. **Implementation phase** — Implementer (Flight, same person as Lead) executes the revised spec faithfully with zero design decisions remaining.
4. **Audit phase** — Reviewer (CONTROL) verifies directive landed exactly as specified.

This workflow produced high-fidelity implementation in one pass. Compare to workflows where directives become decisions entries without spec integration: implementer must interpret directive intent, spec may contain now-obsolete fallback language, leads to ambiguity and revision cycles.

Future CONTROL directives should follow this model: get into the spec before implementation kickoff.
