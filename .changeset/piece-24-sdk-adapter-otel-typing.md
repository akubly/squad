---
'@bradygaster/squad-sdk': patch
---

Tighten OTel adapter typing and SDK internal naming (piece 24 — D-6, D-8, D-9, D-16).

- **D-6**: Introduce `CopilotSessionLike` and `CopilotSessionRawEvent` interfaces in `adapter/client.ts`; remove 4 `eslint-disable-next-line` suppression comments.
- **D-8**: Add `runtime/otel-types.ts` with local structural interfaces for OTel no-op objects (`OTelSpanLike`, `OTelTracerLike`, `OTelInstrumentLike`, `OTelMeterLike`, `OTelDiagLike`, `OTelDiagLogLevelMap`); replace blanket `any` block and 3 inline `eslint-disable-line` comments in `otel-api.ts`.
- **D-9**: Add `OTelNodeSDKConstructor`, `OTelResourceConstructor`, `OTelMetricReaderConstructor`, `OTelExporterConstructor` constructor interfaces to `otel-types.ts`; remove 3 `eslint-disable-line` comments from `otel.ts`.
- **D-16**: Rename `AgentHandleImpl.markIdle()` → `setIdle()`; remove misleading `@internal` annotation on a non-exported class method.

Zero `any`, `as`, `!` (non-null assertion), or `@ts-*` introduced in the typed surface. D-14 (span propagation) deferred.

---

**Rev (EECOM, 2026-05-27) — FIDO nits N1–N4:**

- **N1** (§9 smoke test): Added `setAttribute`/`isRecording` assertions to noop tracer smoke test; `expect(span.isRecording()).toBe(false)` is the key §9 guard.
- **N2** (arity coverage): Added `_noopStartActiveSpan` arity test covering all three call shapes — `(name, fn)`, `(name, opts, fn)`, `(name, opts, ctx, fn)` — with return-value propagation assertions confirming `ReturnType<F>` preservation.
- **N3** (annotation restore): Widened `OTelSpanLike.addEvent` second param to `unknown` (matching real OTel `Span.addEvent(name, attributesOrStartTime?, startTime?)`) so structural compatibility holds without suppressions. Changed `Tracer`/`Meter` type aliases in `otel-api.ts` from real OTel import-types to `OTelTracerLike`/`OTelMeterLike`, making them self-contained while structurally equivalent. Restored `: Tracer` and `: Meter` explicit return-type annotations on `getTracer()` and `getMeter()` in `otel.ts`.
- **N4** (cosmetic indent): Fixed 12-space → 10-space indent on `agent.setIdle()` in `lifecycle.ts`.
