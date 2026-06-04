# Proposal: Piece 24 — SDK Adapter and OTel Typing Hardening

**Author:** Flight (Lead)  
**Date:** 2026-05-27  
**Status:** Revised (Rev 1 — 2026-05-27, CONTROL 3-overload directive)  
**Scope:** Single PR, SDK-layer `any` removal + lifecycle rename  
**Branch base:** `squad/piece-23-shared-cli-conventions`

---

## Preamble: Item Selection

**Audit source:** `docs/proposals/ship-debt-audit-pieces-1-21.md`

The audit's Decision B priority queue assigns **D-6, D-8, D-9, D-14, D-16** to piece 24 under the "OTel hardening + SDK adapter typing" theme. This piece implements **D-6, D-8, D-9, and D-16 only.**

**D-14 is excluded.** The audit's own remediation note reads "Implement span parenting when agent lifecycle spans are complete." This is implementation work (designing span context propagation across the agent/tool boundary, adding context API calls, modifying runtime behavior) — not typing cleanup. Including D-14 would push the piece well over the 200 LOC ceiling and mix two distinct concerns (removing `any` escape hatches vs. building new OTel tracing features). D-14 is deferred to a dedicated follow-up piece (24b or 25+) once the agent lifecycle span architecture is established as complete.

**CONTROL's N2 (source-grouping exhaustiveness) — not binding for piece 24.** The piece 22 revision decision table deferred N2 ("deferred to follow-up piece per instructions") without naming a specific piece. N2 is a CLI-layer fix (3–5 LOC in `cli-entry.ts`'s `renderFinding` dispatch group). It is orthogonal to piece 24's SDK scope and would muddy the theme. It should be folded into the next CLI piece that opens `cli-entry.ts`, or submitted as a targeted patch PR. No conflict with the item selection below.

**CONTROL's Directive 2 (resolver env seam) — explicitly piece 25, no conflict.** The decisions.md records: "Directive 2 — Resolver env seam (flag for piece 25)." This concerns adding an `env` parameter to `resolveSquadDir` in `cli/core/squad-resolver.ts`. It is entirely orthogonal to piece 24's SDK focus. No tension; no binding constraint on this piece.

---

### Why These Four Items Over Others

**Primary item: D-6** (M-severity) — `adapter/client.ts` carries 4 `eslint-disable-next-line @typescript-eslint/no-explicit-any` annotations masking the untyped Copilot SDK session object. This is the highest-risk typing gap: `any` in the adapter layer means the compiler cannot catch a wrong property access on `this.inner`, misuse of the raw event shape in `normalizeEvent`, or a future API mismatch when the underlying session contract changes. The session object's surface has been stable since piece 12; defining a minimal structural interface is now safe and well-bounded.

**Secondary item: D-8** (M-severity) — `runtime/otel-api.ts` has a blanket `/* eslint-disable @typescript-eslint/no-explicit-any */` block covering the entire no-op section (~38 lines), plus 3 additional inline `eslint-disable-line` comments after the block. The no-op objects model a fixed subset of `@opentelemetry/api`; their shape is deterministic and small. Removing the suppression requires only local interface definitions — no dependency on the optional `@opentelemetry/api` package at compile time.

**Tertiary item: D-9** (S-severity) — `runtime/otel.ts` has 3 `eslint-disable-line @typescript-eslint/no-explicit-any` lines for dynamically-loaded OTel SDK constructor variables. Constructor interfaces for the lazy-loaded classes can be defined in the same new `otel-types.ts` file introduced for D-8, making D-9 a near-free addition to that piece.

**Quaternary item: D-16** (S-severity) — `AgentHandleImpl.markIdle()` in `agents/lifecycle.ts` is marked `@internal` but `AgentHandleImpl` is a non-exported class — the `@internal` tag is redundant and misleading. Its single call site is in the same file (the idle sweep timer). Renaming to `setIdle()` and removing the confusing annotation is a 3-line change that makes the internal state machine more readable without touching the public `AgentHandle` interface.

**Items rejected for piece 24:**
- D-14 (span propagation TODO in `tools/index.ts`): Feature/implementation work with hidden lifecycle dependency — excluded; see above.
- D-18 (`resolveSquad` v1/v2 rename): Breaking SDK change requiring deprecation strategy — piece 25.
- D-10, D-17: Won't fix — intentional, documented.
- All piece 22 and 23 items: Shipped or in-flight on `squad/piece-23-shared-cli-conventions`.

**Piece 23 collision check:** Piece 23 modifies CLI files (`cli/core/`, `cli/commands/`, `cli-entry.ts`, `src/types/`). Piece 24 modifies only SDK files (`packages/squad-sdk/src/adapter/`, `packages/squad-sdk/src/runtime/`, `packages/squad-sdk/src/agents/`). Zero overlap. Stacking is clean.

---

## 1. Problem Statement

### 1.1 Untyped Copilot Session Adapter (D-6)

`CopilotSessionAdapter` in `packages/squad-sdk/src/adapter/client.ts` wraps a raw Copilot SDK session object. The SDK session type is untyped at the Squad boundary, so every access to `this.inner` escapes the compiler:

- `private readonly inner: any;` — field declaration, annotated with `eslint-disable-next-line @typescript-eslint/no-explicit-any`
- `constructor(copilotSession: any)` — constructor parameter, same annotation
- `private static normalizeEvent(sdkEvent: any): SquadSessionEvent` — raw event parameter, same annotation
- `const wrappedHandler = (sdkEvent: any) => { ... }` — event handler lambda parameter, same annotation

Four suppression comments on four access sites. Any wrong property access on `this.inner` (e.g., `this.inner.send` vs `this.inner.sendMessage`), wrong field on the raw SDK event, or future adapter refactor that introduces a type mismatch will be silently accepted by the compiler. The suppressions grow whenever a new access to `inner` is added.

### 1.2 Blanket `any` in OTel No-Op Layer (D-8)

`packages/squad-sdk/src/runtime/otel-api.ts` contains a block-level lint suppression:

```
/* eslint-disable @typescript-eslint/no-explicit-any */
const _noopSpan: any = { ... };
const _noopTracer: any = { ... };
const _noopInstrument: any = { ... };
const _noopMeter: any = { ... };
/* eslint-enable @typescript-eslint/no-explicit-any */
```

After this block, three additional exports carry inline suppressions:

```
export const diag: any = _api?.diag ?? { ... }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const DiagConsoleLogger: any = ...; // eslint-disable-line @typescript-eslint/no-explicit-any
export const DiagLogLevel: any = ...; // eslint-disable-line @typescript-eslint/no-explicit-any
```

The no-op objects are the file's entire purpose — they model a deterministic subset of `@opentelemetry/api`. Having the compiler unable to verify their shape means any deviation from the real OTel API surface (misnamed method, wrong return type, missing method) is silently accepted. A future change that renames `setStatus()` to `setSpanStatus()` inside `_noopSpan` would never be caught.

### 1.3 Dynamic-Import `any` in OTel Initialization (D-9)

`packages/squad-sdk/src/runtime/otel.ts` lazy-loads optional OTel SDK packages via `createRequire`. The loaded constructor variables are declared `any`:

```typescript
let NodeSDK: any, Resource: any, PeriodicExportingMetricReader: any; // eslint-disable-line
let OTLPTraceExporter: any, OTLPMetricExporter: any; // eslint-disable-line
```

And `buildResource` accepts and returns `any`:

```typescript
function buildResource(config?: OTelConfig, Resource?: any): any // eslint-disable-line
```

TypeScript cannot verify that `new NodeSDK({...})` receives a compatible options object, that `Resource` produces a value compatible with the expected attribute shape, or that `buildResource`'s return value is safe to pass to `NodeSDK`. The constructor interfaces needed to fix this are bounded and can be co-located with D-8's type definitions.

### 1.4 Misleading `@internal` on State-Transition Method (D-16)

`AgentHandleImpl.markIdle()` in `packages/squad-sdk/src/agents/lifecycle.ts` bears:

```typescript
/**
 * Mark agent as idle (called by lifecycle manager).
 * @internal
 */
markIdle(): void {
  if (this.status === 'active') {
    this.status = 'idle';
  }
}
```

`AgentHandleImpl` is not exported — it cannot be referenced by any external caller by construction. The `@internal` tag on a non-exported class method is documentation noise that implies an external caller must be warned away when no external caller is possible. The single call site is `agent.markIdle()` inside the idle sweep timer in the same file. The name `markIdle` also breaks the imperative verb pattern used elsewhere in the codebase (`destroy()`, `sendMessage()`, `getMessages()`) — `setIdle()` is consistent with how state assignment methods are typically named.

---

## 2. Target Architecture

### 2.1 `CopilotSessionLike` Interface (D-6)

**File:** `packages/squad-sdk/src/adapter/client.ts` — add two minimal structural interfaces above the `CopilotSessionAdapter` class declaration. Do not import from `@opentelemetry/api` or any other optional package.

```typescript
/** Minimal shape of the raw Copilot SDK session object passed to CopilotSessionAdapter. */
interface CopilotSessionLike {
  readonly sessionId?: string;
  send(options: unknown): Promise<void>;
  sendAndWait(options: unknown, timeout?: number): Promise<unknown>;
  abort(): Promise<void>;
  getMessages(): Promise<unknown[]>;
  on(type: string, handler: (event: CopilotSessionRawEvent) => void): () => void;
}

/** Minimal shape of a raw Copilot SDK session event before normalization. */
interface CopilotSessionRawEvent {
  type: string;
  data?: Record<string, unknown>;
}
```

With these interfaces in place:
- `private readonly inner: any` → `private readonly inner: CopilotSessionLike`
- `constructor(copilotSession: any)` → `constructor(copilotSession: CopilotSessionLike)`
- `normalizeEvent(sdkEvent: any): SquadSessionEvent` → `normalizeEvent(sdkEvent: CopilotSessionRawEvent): SquadSessionEvent`
- `const wrappedHandler = (sdkEvent: any) =>` → `const wrappedHandler = (sdkEvent: CopilotSessionRawEvent) =>`

All 4 `eslint-disable-next-line` comments are removed. The accesses `this.inner.sessionId`, `this.inner.send`, `this.inner.sendAndWait`, `this.inner.abort`, `this.inner.getMessages`, and `this.inner.on` are now verified by the compiler.

### 2.2 OTel No-Op Types in `runtime/otel-types.ts` (D-8)

**New file:** `packages/squad-sdk/src/runtime/otel-types.ts`

Define minimal local interfaces for the no-op object shapes. Do NOT import `@opentelemetry/api` — it is an optional runtime dependency that may not be installed. Use only structural typing:

```typescript
/** Minimal OTel Span-compatible interface (no-op and real shapes). */
export interface OTelSpanLike {
  end(): void;
  setStatus(status: { code: number; message?: string }): OTelSpanLike;
  setAttribute(key: string, value: unknown): OTelSpanLike;
  setAttributes(attrs: Record<string, unknown>): OTelSpanLike;
  addEvent(name: string, attrs?: Record<string, unknown>): OTelSpanLike;
  recordException(exception: unknown): OTelSpanLike;
  isRecording(): boolean;
  updateName(name: string): OTelSpanLike;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
}

/** Minimal OTel Tracer-compatible interface (matches OTel's 3 concrete overloads exactly). */
export interface OTelTracerLike {
  startSpan(name: string, options?: unknown, context?: unknown): OTelSpanLike;
  startActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, context: unknown, fn: F): ReturnType<F>;
}

/** Minimal OTel Instrument-compatible interface (counter, histogram, gauge). */
export interface OTelInstrumentLike {
  add(value: number, attrs?: Record<string, unknown>): void;
  record(value: number, attrs?: Record<string, unknown>): void;
  addCallback(callback: unknown): void;
  removeCallback(callback: unknown): void;
}

/** Minimal OTel Meter-compatible interface. */
export interface OTelMeterLike {
  createCounter(name: string, options?: unknown): OTelInstrumentLike;
  createUpDownCounter(name: string, options?: unknown): OTelInstrumentLike;
  createHistogram(name: string, options?: unknown): OTelInstrumentLike;
  createObservableCounter(name: string, options?: unknown): OTelInstrumentLike;
  createObservableUpDownCounter(name: string, options?: unknown): OTelInstrumentLike;
  createObservableGauge(name: string, options?: unknown): OTelInstrumentLike;
  createGauge(name: string, options?: unknown): OTelInstrumentLike;
}

/** Minimal OTel DiagAPI-compatible interface. */
export interface OTelDiagLike {
  setLogger(logger: unknown, logLevel?: unknown): void;
  disable(): void;
  verbose(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Numeric log level values mirroring DiagLogLevel from @opentelemetry/api. */
export type OTelDiagLogLevelMap = {
  readonly NONE: number;
  readonly ERROR: number;
  readonly WARN: number;
  readonly INFO: number;
  readonly DEBUG: number;
  readonly VERBOSE: number;
  readonly ALL: number;
};
```

**Update `otel-api.ts`:**
- Add import: `import type { OTelSpanLike, OTelTracerLike, OTelInstrumentLike, OTelMeterLike, OTelDiagLike, OTelDiagLogLevelMap } from './otel-types.js';`
- Remove `/* eslint-disable @typescript-eslint/no-explicit-any */` (line ~30)
- Remove `/* eslint-enable @typescript-eslint/no-explicit-any */` (line ~69)
- Replace `const _noopSpan: any = { ... }` → `const _noopSpan: OTelSpanLike = { ... }`
- Replace `const _noopTracer: any = { ... }` → extract `startActiveSpan` as a standalone function (4 signatures: 3 overloads + 1 implementation body) and assign `const _noopTracer: OTelTracerLike = { startSpan: ..., startActiveSpan: _noopStartActiveSpan }`. The implementation body narrows the callback via `typeof callback !== 'function'` — no `any`, no `as`, no `@ts-*`.
- Replace `const _noopInstrument: any = { ... }` → `const _noopInstrument: OTelInstrumentLike = { ... }`
- Replace `const _noopMeter: any = { ... }` → `const _noopMeter: OTelMeterLike = { ... }`
- Replace `export const diag: any = ...` → `export const diag: OTelDiagLike = ...` — remove `eslint-disable-line`
- Replace `export const DiagConsoleLogger: any = ...` → type as `new() => OTelDiagLike` or `{ new(): OTelDiagLike }` — remove `eslint-disable-line`
- Replace `export const DiagLogLevel: any = ...` → `export const DiagLogLevel: OTelDiagLogLevelMap = ...` — remove `eslint-disable-line`

*No suppression needed — the 3-overload form narrows cleanly under strict mode (per CONTROL's piece-24 type review, 2026-05-27).*

### 2.3 OTel SDK Constructor Types (D-9)

**Additional exports added to `runtime/otel-types.ts`:**

```typescript
/** Constructor interface for @opentelemetry/sdk-node NodeSDK. */
export interface OTelNodeSDKConstructor {
  new(options: { resource?: unknown; traceExporter?: unknown; metricReader?: unknown }): {
    start(): void;
    shutdown(): Promise<void>;
  };
}

/** Constructor interface for @opentelemetry/sdk-node Resource. */
export interface OTelResourceConstructor {
  new(attrs: Record<string, string>): unknown;
}

/** Constructor interface for PeriodicExportingMetricReader. */
export interface OTelMetricReaderConstructor {
  new(options: { exporter: unknown; exportIntervalMillis?: number }): unknown;
}

/** Constructor interface for OTLP trace/metric exporters. */
export interface OTelExporterConstructor {
  new(options: { url: string }): unknown;
}
```

**Update `otel.ts`:**
- Add import: `import type { OTelNodeSDKConstructor, OTelResourceConstructor, OTelMetricReaderConstructor, OTelExporterConstructor } from './otel-types.js';`
- `function buildResource(config?: OTelConfig, Resource?: any): any // eslint-disable-line` → `function buildResource(config?: OTelConfig, Resource?: OTelResourceConstructor): unknown`
- `let NodeSDK: any, Resource: any, PeriodicExportingMetricReader: any; // eslint-disable-line` → `let NodeSDK: OTelNodeSDKConstructor | undefined, Resource: OTelResourceConstructor | undefined, PeriodicExportingMetricReader: OTelMetricReaderConstructor | undefined;`
- `let OTLPTraceExporter: any, OTLPMetricExporter: any; // eslint-disable-line` → `let OTLPTraceExporter: OTelExporterConstructor | undefined, OTLPMetricExporter: OTelExporterConstructor | undefined;`

All 3 `eslint-disable-line` comments removed. The `new NodeSDK({...})`, `new Resource(attrs)`, and `new OTLPTraceExporter({url})` call sites are now type-checked against the constructor signatures.

### 2.4 `setIdle()` Rename (D-16)

**File:** `packages/squad-sdk/src/agents/lifecycle.ts`

Replace the `markIdle` method on `AgentHandleImpl`:

**Before:**
```typescript
/**
 * Mark agent as idle (called by lifecycle manager).
 * @internal
 */
markIdle(): void {
  if (this.status === 'active') {
    this.status = 'idle';
  }
}
```

**After:**
```typescript
/** Transition agent status from active to idle. Called by the idle sweep timer. */
setIdle(): void {
  if (this.status === 'active') {
    this.status = 'idle';
  }
}
```

Update the single call site in the idle sweep timer (locate by searching for `agent.markIdle()`):
`agent.markIdle();` → `agent.setIdle();`

`markIdle()` is not declared on the `AgentHandle` interface — it exists only on the non-exported `AgentHandleImpl` class. Both the definition and call site are in `lifecycle.ts`. No downstream consumers need updating.

---

## 3. Migration Table

### D-6: `CopilotSessionAdapter` `any` Removals

| Location in `adapter/client.ts` | Current | After Piece 24 |
|---|---|---|
| `inner` field declaration | `private readonly inner: any` + `eslint-disable-next-line` | `private readonly inner: CopilotSessionLike` (no annotation) |
| Constructor parameter | `constructor(copilotSession: any)` + `eslint-disable-next-line` | `constructor(copilotSession: CopilotSessionLike)` |
| `normalizeEvent` parameter | `sdkEvent: any` + `eslint-disable-next-line` | `sdkEvent: CopilotSessionRawEvent` |
| `wrappedHandler` lambda parameter | `(sdkEvent: any) =>` + `eslint-disable-next-line` | `(sdkEvent: CopilotSessionRawEvent) =>` |

### D-8: OTel No-Op `any` Removals in `otel-api.ts`

| Symbol | Current type | After Piece 24 |
|---|---|---|
| `_noopSpan` | `any` (inside blanket disable block) | `OTelSpanLike` |
| `_noopTracer` | `any` (inside blanket disable block) | `OTelTracerLike` |
| `_noopInstrument` | `any` (inside blanket disable block) | `OTelInstrumentLike` |
| `_noopMeter` | `any` (inside blanket disable block) | `OTelMeterLike` |
| `diag` export | `any` + `eslint-disable-line` | `OTelDiagLike` |
| `DiagConsoleLogger` export | `any` + `eslint-disable-line` | typed class expression |
| `DiagLogLevel` export | `any` + `eslint-disable-line` | `OTelDiagLogLevelMap` |
| Blanket block | `/* eslint-disable */` ... `/* eslint-enable */` | Removed entirely |

### D-9: OTel SDK Constructor Variable `any` Removals in `otel.ts`

| Symbol | Current | After Piece 24 |
|---|---|---|
| `NodeSDK`, `Resource`, `PeriodicExportingMetricReader` | `any` × 3 + `eslint-disable-line` | `OTelNodeSDKConstructor \| undefined`, etc. |
| `OTLPTraceExporter`, `OTLPMetricExporter` | `any` × 2 + `eslint-disable-line` | `OTelExporterConstructor \| undefined` × 2 |
| `buildResource` signature | `(Resource?: any): any` + `eslint-disable-line` | `(Resource?: OTelResourceConstructor): unknown` |

### D-16: Lifecycle Rename

| Location in `lifecycle.ts` | Current | After Piece 24 |
|---|---|---|
| `AgentHandleImpl` method declaration | `markIdle(): void` + `@internal` JSDoc | `setIdle(): void` + plain JSDoc |
| Idle sweep timer call site | `agent.markIdle()` | `agent.setIdle()` |

---

## 4. Consumer / Renderer Changes

This piece is purely internal SDK typing. No user-facing output changes and no CLI behavior changes:

- All `squad` CLI commands: unaffected. The adapter and OTel changes are compile-time only.
- OTel spans and metrics: no runtime behavior change. The no-op objects remain behaviorally identical; the real OTel initialization path in `otel.ts` is unchanged at runtime.
- `AgentHandle` interface: unchanged. `setIdle()` is not declared on the public interface — only on the non-exported `AgentHandleImpl` class.

---

## 5. Test Strategy

### Existing Tests — Update Required for D-16

| Test File | What It Tests | Piece 24 Impact |
|---|---|---|
| Any test covering `CopilotSessionAdapter` | Session event dispatch, message send | No assertion changes — types only. Verify mock session object satisfies `CopilotSessionLike`. |
| Any test covering `otel-api.ts` noop exports | `otelApiAvailable` flag, noop tracer/span usage | No assertion changes — shapes identical at runtime. |
| Any test covering `agents/lifecycle.ts` | Agent spawn, status transitions, idle detection | Search for `markIdle` — update any references to `setIdle`. |

### New Tests Required

The implementer MUST add these tests before the PR is reviewable:

1. **`CopilotSessionLike` conformance check** — If a mock or stub Copilot session object exists in any test fixture, assign it to a `CopilotSessionLike`-typed variable in the test setup to verify it satisfies the interface at compile time. This is a zero-runtime-assertion test: if the build passes, the mock is compatible.

2. **No-op tracer/span smoke test** — Verify that calling the no-op methods does not throw. The valuable assertion is runtime safety:
   ```typescript
   const span = noopTracer.startSpan('test');
   span.setAttribute('key', 'val');
   span.end();
   expect(span.isRecording()).toBe(false);
   ```
   If such smoke tests already exist in the OTel test suite, verify they still pass after the type update.

3. **`markIdle` grep gate** — Before committing: `grep -rn "markIdle" packages/squad-sdk/src` must return zero results. This is a required pre-commit verification, not a new test file.

### What NOT to Test

- Do NOT add runtime tests for `otel-types.ts` interface shapes — interfaces are erased at runtime.
- Do NOT add tests for the `@opentelemetry/api` real API surface.
- Do NOT implement D-14 (span propagation) as part of the test setup.

---

## 6. Risk + Rollback

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `CopilotSessionLike` is incomplete — real SDK session has a method not in the interface | Low | Interface covers all 6 method accesses on `this.inner` visible in `client.ts`. TypeScript will flag missing methods at new call sites. |
| `OTelSpanLike` fluent methods have wrong return type — real `Span` returns `this` | Low | No-op fluent methods return `_noopSpan` (structurally satisfies `OTelSpanLike`). Use `OTelSpanLike` as return type on fluent signatures. |
| `_noopTracer.startActiveSpan` 3-overload standalone function | Low | CONTROL confirmed: OTel's real API is 3 concrete overloads (not variadic). The standalone function form attaches overload signatures cleanly; `typeof callback !== 'function'` narrows the implementation body without any `any`/`as`/`@ts-*`. Zero suppression risk. |
| Piece 23 EECOM rev commit has not yet landed when piece 24 is picked up | High (expected) | Branch from `squad/piece-23-shared-cli-conventions` after the rev commit. The rev commit touches CLI files only; piece 24's SDK changes are orthogonal. |
| D-16 rename: undiscovered external callers of `markIdle` | Very Low | `AgentHandleImpl` is not exported. `grep -rn "markIdle" packages/squad-sdk/src` confirms only 2 sites (definition + call), both in `lifecycle.ts`. |

### Rollback Plan

Single PR revert. `otel-types.ts` (new file) is additive. `adapter/client.ts` interface additions are additive. The D-16 rename reverts to `markIdle()` with no behavioral change. No data migration; no persistence layer touched; no CLI command behavior affected.

---

## 7. Out of Scope

- ❌ Do NOT implement D-14 (span propagation — tool spans as children of agent spans in `tools/index.ts`) — feature work, lifecycle dependency, own piece
- ❌ Do NOT tackle D-18 (`resolveSquad` v1/v2 SDK rename) — breaking change, piece 25
- ❌ Do NOT address CONTROL's N2 (source-grouping exhaustiveness in `cli-entry.ts`) — CLI-layer doctor fix, not SDK typing
- ❌ Do NOT add the `env` seam to `resolveSquadDir` (CONTROL's Directive 2) — explicitly filed for piece 25
- ❌ Do NOT import `@opentelemetry/api` as a compile-time non-optional type dependency — interfaces in `otel-types.ts` must be locally defined; `@opentelemetry/api` must remain an optional runtime-only dependency
- ❌ Do NOT touch any CLI files (`packages/squad-cli/src/`) — piece 24 is SDK-only
- ❌ Do NOT remove the `try/catch` around `_api = _require('@opentelemetry/api')` in `otel-api.ts` — the graceful fallback on missing optional dep is intentional and must stay
- ❌ Do NOT change any OTel runtime behavior (span emission, metric recording, shutdown timing, endpoint configuration) — this is typing only
- ❌ Do NOT add `setIdle()` to the `AgentHandle` public interface — the method is internal to `AgentHandleImpl` and should remain so

---

## 8. LOC Budget

**Hard ceiling: 200 production LOC net change (excluding test files).**

Estimated breakdown:

| Change | +LOC | -LOC |
|---|---|---|
| `adapter/client.ts` — `CopilotSessionLike` + `CopilotSessionRawEvent` interfaces (above class) | +17 | 0 |
| `adapter/client.ts` — remove 4 `eslint-disable-next-line` comments; update 4 `any` to interface types | +0 | -4 |
| `runtime/otel-types.ts` — new file: 7 no-op shape interfaces + 4 constructor interfaces; `OTelTracerLike` uses 3 concrete overloads; `_noopStartActiveSpan` standalone function (4 sigs) | +63 | 0 |
| `runtime/otel-api.ts` — add import; remove blanket disable block (×2 comment lines); update 7 `any` declarations; remove 3 inline disable comments | +1 | -12 |
| `runtime/otel.ts` — add import; update 5 `any` declarations + remove 3 inline disable comments; update `buildResource` signature | +1 | -6 |
| `agents/lifecycle.ts` — remove `@internal` JSDoc block (×3 lines); rename method + call site; replace JSDoc (×1 line) | +2 | -3 |
| **Total** | **+84** | **-25** |
| **Net** | **+59 LOC** | |

Expected diff: ~138 gross lines changed, ~59 net (+8 over the original ~51 baseline per CONTROL's 3-overload directive). Approximately 141 LOC of ceiling headroom remains. This headroom accommodates interface bodies larger than estimated (the `OTelSpanLike` interface has 9 methods; the `OTelMeterLike` has 7) and any call sites discovered during implementation that require additional import lines.

---

## 9. Acceptance Criteria

The reviewer can tick these boxes independently:

- [ ] `packages/squad-sdk/src/runtime/otel-types.ts` exists and exports `OTelSpanLike`, `OTelTracerLike`, `OTelInstrumentLike`, `OTelMeterLike`, `OTelDiagLike`, `OTelDiagLogLevelMap`
- [ ] `runtime/otel-types.ts` also exports `OTelNodeSDKConstructor`, `OTelResourceConstructor`, `OTelMetricReaderConstructor`, `OTelExporterConstructor`
- [ ] `runtime/otel-types.ts` does NOT import from `@opentelemetry/api` (all interfaces locally defined)
- [ ] `runtime/otel-api.ts` has NO `/* eslint-disable @typescript-eslint/no-explicit-any */` block (grep confirms)
- [ ] `runtime/otel-api.ts` has NO `eslint-disable-line @typescript-eslint/no-explicit-any` comments (grep confirms)
- [ ] `runtime/otel.ts` has NO `eslint-disable-line @typescript-eslint/no-explicit-any` comments (grep confirms)
- [ ] `adapter/client.ts` has NO `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments (grep confirms)
- [ ] `adapter/client.ts` defines `CopilotSessionLike` and `CopilotSessionRawEvent` interfaces above the class
- [ ] `agents/lifecycle.ts` has zero occurrences of `markIdle` (grep confirms)
- [ ] `AgentHandleImpl.setIdle()` exists in `agents/lifecycle.ts` without `@internal` annotation
- [ ] Idle sweep timer in `lifecycle.ts` calls `agent.setIdle()` (not `agent.markIdle()`)
- [ ] `npm run build -w packages/squad-sdk` passes clean
- [ ] `npm run lint` passes clean (zero new `eslint-disable` or `@ts-*` comments of any kind)
- [ ] `_noopTracer` / `_noopSpan` conform to `OTelTracerLike` / `OTelSpanLike` with zero `any` / `as` / `!` / `@ts-*` / eslint-disable in the typed surface
- [ ] No new npm dependencies added to `packages/squad-sdk/package.json`
- [ ] Smoke test for no-op tracer/span: `startSpan`, `setAttribute`, `end`, `isRecording` do not throw
- [ ] All existing `markIdle` references in test files (if any) updated to `setIdle`
- [ ] `.changeset/piece-24-sdk-adapter-otel-typing.md` present with `patch` bump for `@bradygaster/squad-sdk`
- [ ] PR references `docs/proposals/piece-24-sdk-adapter-otel-typing.md`

---

## References

- SDK adapter: `packages/squad-sdk/src/adapter/client.ts` (audit D-6: 4 `eslint-disable-next-line` at `inner` field, constructor, `normalizeEvent`, `wrappedHandler`)
- OTel no-op wrapper: `packages/squad-sdk/src/runtime/otel-api.ts` (audit D-8: blanket disable block; 3 inline `eslint-disable-line` on `diag`, `DiagConsoleLogger`, `DiagLogLevel`)
- OTel initialization: `packages/squad-sdk/src/runtime/otel.ts` (audit D-9: 3 inline `eslint-disable-line` on `buildResource`, NodeSDK/Resource/PMR group, OTLP exporter group)
- Agent lifecycle: `packages/squad-sdk/src/agents/lifecycle.ts` (audit D-16: `markIdle()` + `@internal` on `AgentHandleImpl`)
- Audit source: `docs/proposals/ship-debt-audit-pieces-1-21.md`
- Priority decision: `.squad/decisions.md` — Decision B, Ship-Debt Priority Queue
- Piece 22 revision: CONTROL N2 deferral (source-grouping exhaustiveness, not binding for piece 24)
- CONTROL Directive 2 (resolver env seam): `.squad/decisions.md` — filed for piece 25, no conflict
- CONTROL type directive: `.squad/decisions.md` — 2026-05-27 noop-tracer typing revision (OTel 3-overload form)

---

## Revision History

| Date | Author | Change |
|---|---|---|
| 2026-05-27 | Flight (Lead) | Initial spec authored — variadic `startActiveSpan` signature, single-line eslint-disable concession noted as acceptable fallback. |
| 2026-05-27 | Flight (Lead) | **Rev 1 — CONTROL noop-tracer directive.** Replaced variadic generic `startActiveSpan` in `OTelTracerLike` with OTel's 3 concrete overloads. Noop implementation extracted as standalone function (`_noopStartActiveSpan`) so overload signatures attach cleanly. Removed all eslint-disable concession language. LOC envelope revised from ~51 to ~59 net (+8 per CONTROL's analysis). Risk table updated; acceptance criteria updated to require zero suppression in the typed surface. Spec is now consistent with `@opentelemetry/api`'s actual interface and imposes no lint exceptions on the implementer. |
