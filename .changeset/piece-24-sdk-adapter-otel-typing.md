---
'@bradygaster/squad-sdk': patch
---

Tighten OTel adapter typing and SDK internal naming (piece 24 — D-6, D-8, D-9, D-16).

- **D-6**: Introduce `CopilotSessionLike` and `CopilotSessionRawEvent` interfaces in `adapter/client.ts`; remove 4 `eslint-disable-next-line` suppression comments.
- **D-8**: Add `runtime/otel-types.ts` with local structural interfaces for OTel no-op objects (`OTelSpanLike`, `OTelTracerLike`, `OTelInstrumentLike`, `OTelMeterLike`, `OTelDiagLike`, `OTelDiagLogLevelMap`); replace blanket `any` block and 3 inline `eslint-disable-line` comments in `otel-api.ts`.
- **D-9**: Add `OTelNodeSDKConstructor`, `OTelResourceConstructor`, `OTelMetricReaderConstructor`, `OTelExporterConstructor` constructor interfaces to `otel-types.ts`; remove 3 `eslint-disable-line` comments from `otel.ts`.
- **D-16**: Rename `AgentHandleImpl.markIdle()` → `setIdle()`; remove misleading `@internal` annotation on a non-exported class method.

Zero `any`, `as`, `!` (non-null assertion), or `@ts-*` introduced in the typed surface. D-14 (span propagation) deferred.
