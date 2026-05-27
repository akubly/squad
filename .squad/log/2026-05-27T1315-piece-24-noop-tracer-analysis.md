# Session Log — 2026-05-27T13:15:00Z

## Topic: Piece 24 Noop Tracer Analysis — Pre-Implementation Design Directive

**Agent:** CONTROL  
**Mode:** background  
**Branch:** `squad/piece-23-shared-cli-conventions`

### Problem Statement

Flight's piece-24 spec includes a design concession: "one acceptable `eslint-disable-next-line` on `_noopTracer.startActiveSpan` to suppress `@typescript-eslint/no-explicit-any`." CONTROL investigated whether this concession was necessary or if an alternative design could eliminate suppression entirely.

### Key Finding

**The ESLint rule `@typescript-eslint/no-explicit-any` is NOT active in the project's lint config.**

Scan of `eslint.config.mjs` reveals exactly three configured rules: `@typescript-eslint/no-floating-promises`, `n/no-sync`, `no-console`. The suppressions in `runtime/otel-api.ts` (both block-level `/* eslint-disable */` and inline `// eslint-disable-line` comments) target a rule that does not fire. They are dead code.

**Implication:** Flight's spec framing ("acceptable single concession") gestures at a suppression that would be dead code anyway. The motivation to eliminate written `any` is correct (type-system discipline), but the "acceptable suppression" is misleading — the suppression is already inert.

### Technical Analysis

**OTel API Structure (from `node_modules/@opentelemetry/api/build/src/trace/tracer.d.ts`):**

The real `Tracer.startActiveSpan` has exactly THREE concrete overloads, not a single variadic signature:

1. `startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>`
2. `startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>`
3. `startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, context: Context, fn: F): ReturnType<F>`

Flight's proposed `OTelTracerLike` interface uses a variadic generic (`<T>(...args: [string, ...unknown[], (span: OTelSpanLike) => T]): T | undefined`), which is a single-signature approximation. This approximation is weaker: callers lose `ReturnType<F>` inference.

### Recommended Solution (Alt 1)

Redesign `OTelTracerLike.startActiveSpan` from variadic generic to 3 concrete overloads (matching OTel exactly). Define a standalone `_noopStartActiveSpan` function with 4 signatures (3 overloads + 1 implementation).

**Implementation pattern:**
```typescript
function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, fn: F): ReturnType<F>;
function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, fn: F): ReturnType<F>;
function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, context: unknown, fn: F): ReturnType<F>;
function _noopStartActiveSpan(
  _name: string,
  fnOrOptions: unknown,
  contextOrFn?: unknown,
  fn?: unknown,
): unknown {
  const callback = fn ?? (typeof contextOrFn === 'function' ? contextOrFn : fnOrOptions);
  if (typeof callback !== 'function') return undefined;
  return callback(_noopSpan);
}
```

**Why this compiles without suppression:**
- Parameters typed `unknown` (no written `any`)
- `typeof callback !== 'function'` is a standard TypeScript type guard (narrows to `Function`)
- Function call produces implicit `any` return (not written `any`; not flagged by `no-explicit-any`)
- All three overloads satisfied structurally
- Zero written `any`, zero `as`, zero `!`, zero `@ts-*`

### LOC Impact

- Alt 1: ~+8 LOC over baseline (4 signatures + implementation)
- Spec headroom: 149 of 200 LOC remains
- No budget revision needed

### Alternatives Evaluated

- **Alt 2** (callsite narrowing): Doesn't remove written `any` from noop itself; not viable
- **Alt 3** (`Parameters<Tracer['startActiveSpan']>`): Returns only last overload's tuple; cannot union all 3
- **Alt 4** (`as OTelTracerLike` cast): Uses type assertion (counts as suppression mechanism)
- **Alt 5** (OTel's `NOOP_TRACER`): Not applicable; noop exists for OTel-absent case

### Action Implied

Flight should revise piece-24 §2.2 before implementation kickoff. Brady's decision pending.

### Recommendation for Future Maintainers

When analyzing type-suppression trade-offs, verify that the underlying lint rule is actually configured in `eslint.config.mjs`. A configured rule is not guaranteed; its presence enables the suppression semantics (dead or active). This analysis surfaces lint-rule coupling gaps that future toolchain changes may expose.
