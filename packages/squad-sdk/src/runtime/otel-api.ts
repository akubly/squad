/**
 * Resilient @opentelemetry/api wrapper (Issue #247)
 *
 * Re-exports the subset of @opentelemetry/api that Squad uses, with
 * automatic no-op fallbacks when the package is not installed.  This
 * makes telemetry truly optional at runtime — the SDK never crashes
 * due to a missing OpenTelemetry dependency.
 *
 * @module runtime/otel-api
 */

import { createRequire } from 'node:module';
import type { OTelSpanLike, OTelTracerLike, OTelInstrumentLike, OTelMeterLike, OTelDiagLike, OTelDiagLoggerLike, OTelDiagLogLevelMap } from './otel-types.js';

// ---------------------------------------------------------------------------
// Dynamic load — graceful fallback when @opentelemetry/api is absent
// ---------------------------------------------------------------------------

let _api: typeof import('@opentelemetry/api') | undefined;
try {
  const _require = createRequire(import.meta.url);
  _api = _require('@opentelemetry/api');
} catch {
  // @opentelemetry/api not installed — all telemetry becomes no-op
}

// ---------------------------------------------------------------------------
// No-op implementations (mirror the @opentelemetry/api surface we use)
// ---------------------------------------------------------------------------

const _noopSpan: OTelSpanLike = {
  end() {},
  setStatus() { return _noopSpan; },
  setAttribute() { return _noopSpan; },
  setAttributes() { return _noopSpan; },
  addEvent() { return _noopSpan; },
  recordException() { return _noopSpan; },
  isRecording() { return false; },
  updateName() { return _noopSpan; },
  spanContext() { return { traceId: '', spanId: '', traceFlags: 0 }; },
};

function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, fn: F): ReturnType<F>;
function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, fn: F): ReturnType<F>;
function _noopStartActiveSpan<F extends (span: OTelSpanLike) => unknown>(name: string, options: unknown, context: unknown, fn: F): ReturnType<F>;
function _noopStartActiveSpan(_name: string, fnOrOpts: unknown, ctxOrFn?: unknown, fn?: unknown): unknown {
  const callback = typeof fn === 'function' ? fn : (typeof ctxOrFn === 'function' ? ctxOrFn : fnOrOpts);
  if (typeof callback !== 'function') return undefined;
  return callback(_noopSpan);
}

const _noopTracer: OTelTracerLike = {
  startSpan() { return _noopSpan; },
  startActiveSpan: _noopStartActiveSpan,
};

const _noopInstrument: OTelInstrumentLike = {
  add() {},
  record() {},
  addCallback() {},
  removeCallback() {},
};

const _noopMeter: OTelMeterLike = {
  createCounter() { return _noopInstrument; },
  createUpDownCounter() { return _noopInstrument; },
  createHistogram() { return _noopInstrument; },
  createObservableCounter() { return _noopInstrument; },
  createObservableUpDownCounter() { return _noopInstrument; },
  createObservableGauge() { return _noopInstrument; },
  createGauge() { return _noopInstrument; },
};

// ---------------------------------------------------------------------------
// Exports — real API when available, no-ops otherwise
// ---------------------------------------------------------------------------

/** Span status codes. */
export const SpanStatusCode: { readonly UNSET: 0; readonly OK: 1; readonly ERROR: 2 } =
  _api?.SpanStatusCode ?? ({ UNSET: 0, OK: 1, ERROR: 2 } as const);

/** Trace API entry point. */
export const trace = _api?.trace ?? {
  getTracer(): OTelTracerLike { return _noopTracer; },
};

/** Metrics API entry point. */
export const metrics = _api?.metrics ?? {
  getMeter(): OTelMeterLike { return _noopMeter; },
};

/** Diagnostics API. */
export const diag: OTelDiagLike = _api?.diag ?? {
  setLogger() {},
  disable() {},
  verbose() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Diagnostics console logger class. */
export const DiagConsoleLogger: { new(): OTelDiagLoggerLike } = _api?.DiagConsoleLogger ?? class NoopDiagLogger {
  verbose(_msg: string, ..._args: unknown[]): void {}
  debug(_msg: string, ..._args: unknown[]): void {}
  info(_msg: string, ..._args: unknown[]): void {}
  warn(_msg: string, ..._args: unknown[]): void {}
  error(_msg: string, ..._args: unknown[]): void {}
};

/** Diagnostics log level enum. */
export const DiagLogLevel: OTelDiagLogLevelMap = _api?.DiagLogLevel ?? {
  NONE: 0, ERROR: 30, WARN: 50, INFO: 60, DEBUG: 70, VERBOSE: 80, ALL: 9999,
};

/** Whether @opentelemetry/api was successfully loaded. */
export const otelApiAvailable: boolean = _api !== undefined;

// Type aliases — resolves to the local structural interfaces; no compile-time
// dependency on @opentelemetry/api, while remaining structurally compatible.
export type Tracer = OTelTracerLike;
export type Meter = OTelMeterLike;
