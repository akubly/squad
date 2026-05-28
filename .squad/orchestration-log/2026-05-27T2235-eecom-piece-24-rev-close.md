# Orchestration — EECOM Piece 24 Rev Close

**Timestamp:** 2026-05-27T22:35:00-07:00  
**Agent:** EECOM (Core Dev)  
**Task:** Address FIDO's three mandatory nits (N1–N3) + cosmetic N4–N5 on piece-24 commit `b1a710fd`  
**Branch:** `squad/piece-24-sdk-adapter-otel-typing`  
**Commit:** `0325a335` (on top of Flight base `b1a710fd`)

## Outcome

✅ **ALL NITS CLOSED.** Stack now in committed-locally complete state awaiting Brady flow.

### Nits Addressed

| Nit | Item | Status |
|-----|------|--------|
| N1 | Smoke test missing `setAttribute`/`isRecording` assertions | ✅ Added both to `test/otel-provider.test.ts` |
| N2 | All 3 `_noopStartActiveSpan` arities not tested | ✅ Added 3 arity-coverage tests (2-arg, 3-arg, 4-arg) |
| N3 | `getTracer()`/`getMeter()` return annotations removed | ✅ Restored via type widening; zero suppressions |
| N4 | Indentation inconsistency in `lifecycle.ts` | ✅ Fixed `agent.setIdle()` indent |
| N5 | Chain handoff date/hashes | ✅ Date corrected, all hashes populated |

### Gate Results

| Gate | Status |
|------|--------|
| `tsc --noEmit` | ✅ Clean |
| `npm run build -w packages/squad-sdk` | ✅ Clean |
| `npm run lint` | ✅ Clean |
| `otel-provider.test.ts` (24 tests) | ✅ All pass |
| `otel-agent-traces.test.ts` (10 tests) | ✅ All pass |
| Zero suppressions in typed surface | ✅ |

### Key Decision — Type Widening for Structural Conformance

**N3 challenge:** Restore return annotations on `getTracer()`/`getMeter()` without suppressions.

**Root cause:** Real OTel `Span.recordException` returns `void` (not `OTelSpanLike`), and `addEvent` params are `SpanAttributes | TimeInput` (not `Record<string,unknown>`). TypeScript's covariant return check fails.

**Solution:** Widen local interfaces to match real OTel structurally:
- `OTelSpanLike.addEvent` params → `unknown`
- `OTelSpanLike.recordException` return → `void`
- `OTelMeterLike` returns → specific per instrument (counter: `{add}`, histogram/gauge: `{record}`, observables: `{addCallback,removeCallback}`)
- `Tracer`/`Meter` aliases → `OTelTracerLike`/`OTelMeterLike` (union collapses)

**Result:** Annotations restored. Zero suppressions. No `as`/`any`/`@ts-*`.

### Files Modified

- `packages/squad-sdk/src/otel/otel-types.ts` — widened structural interfaces
- `packages/squad-sdk/src/otel/otel-api.ts` — restored Tracer/Meter aliases
- `packages/squad-sdk/src/otel.ts` — restored return annotations
- `packages/squad-sdk/src/lifecycle.ts` — indent fix
- `test/otel-provider.test.ts` — N1 + N2 test additions
- `.changeset/piece-24-sdk-adapter-otel-typing.md` — rev note appended
- `.squad/agents/eecom/history.md` — appended

**Net production LOC:** ~13 (rev only; full piece-24: ~125)  
**Net test LOC:** ~40  
**Total diff:** ~53 net lines

### Status

**Complete.** Full piece-21→24 stack committed-locally. All FIDO nits closed. Awaiting Brady's call on verification re-review or proceed to merge cascade.

**Lockout state:** Lapses when this rev is accepted by Brady or re-review verdict.
