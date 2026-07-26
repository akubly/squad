/**
 * Local OTel type interfaces — compile-time only (piece 24 / D-8, D-9).
 *
 * Defines minimal structural interfaces that mirror the @opentelemetry/api
 * and @opentelemetry/sdk-node surfaces that Squad uses.  These are LOCAL
 * definitions: they do NOT import from @opentelemetry/api, keeping that
 * package strictly optional at runtime.
 *
 * @module runtime/otel-types
 */

/** Minimal OTel Span-compatible interface (no-op and real shapes). */
export interface OTelSpanLike {
  end(): void;
  setStatus(status: { code: number; message?: string }): OTelSpanLike;
  setAttribute(key: string, value: unknown): OTelSpanLike;
  setAttributes(attrs: Record<string, unknown>): OTelSpanLike;
  addEvent(name: string, attributesOrStartTime?: unknown, startTime?: unknown): OTelSpanLike;
  recordException(exception: unknown): void;
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
  createCounter(name: string, options?: unknown): { add(value: number, attrs?: unknown): void };
  createUpDownCounter(name: string, options?: unknown): { add(value: number, attrs?: unknown): void };
  createHistogram(name: string, options?: unknown): { record(value: number, attrs?: unknown): void };
  createObservableCounter(name: string, options?: unknown): { addCallback(cb: unknown): void; removeCallback(cb: unknown): void };
  createObservableUpDownCounter(name: string, options?: unknown): { addCallback(cb: unknown): void; removeCallback(cb: unknown): void };
  createObservableGauge(name: string, options?: unknown): { addCallback(cb: unknown): void; removeCallback(cb: unknown): void };
  createGauge(name: string, options?: unknown): { record(value: number, attrs?: unknown): void };
}

/** Minimal OTel DiagAPI-compatible interface (the `diag` singleton). */
export interface OTelDiagLike {
  setLogger(logger: unknown, logLevel?: unknown): void;
  disable(): void;
  verbose(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Minimal OTel DiagLogger-compatible interface (logger instances, e.g. DiagConsoleLogger). */
export interface OTelDiagLoggerLike {
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
