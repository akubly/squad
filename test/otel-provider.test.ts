/**
 * OTel Provider Tests — OpenTelemetry initialization module
 *
 * Tests the OTel provider module (packages/squad-sdk/src/runtime/otel.ts).
 *
 * API surface:
 * - initializeOTel(config?) — sets up TracerProvider + MeterProvider
 * - initializeTracing(config?) — tracing only
 * - initializeMetrics(config?) — metrics only
 * - getTracer(name?) — returns a Tracer (no-op when unconfigured)
 * - getMeter(name?) — returns a Meter (no-op when unconfigured)
 * - shutdownOTel() — graceful shutdown of providers
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
  initializeOTel,
  initializeTracing,
  initializeMetrics,
  getTracer,
  getMeter,
  shutdownOTel,
} from '@bradygaster/squad-sdk/runtime/otel';
import { trace as rawTrace } from '@bradygaster/squad-sdk/runtime/otel-api';
import { ROOT_CONTEXT } from '@opentelemetry/api';

// Resets the global OTel tracer provider to the built-in noop so that tests
// measuring noop behavior are not contaminated by a provider registered by a
// previous initializeOTel() call in this file.
function disableGlobalTracer(): void {
  if (typeof (rawTrace as Record<string, unknown>)['disable'] === 'function') {
    (rawTrace as { disable(): void }).disable();
  }
}

// ---------------------------------------------------------------------------
// Helpers: save/restore env
// ---------------------------------------------------------------------------

function withCleanEnv(fn: () => void | Promise<void>) {
  return async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    try {
      await fn();
    } finally {
      if (saved === undefined) {
        delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
      } else {
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = saved;
      }
    }
  };
}

// =============================================================================
// initializeOTel
// =============================================================================

describe('OTel Provider — initializeOTel()', { timeout: 30_000 }, () => {
  afterEach(async () => {
    try { await shutdownOTel(); } catch { /* ignore shutdown errors in test cleanup */ }
  });

  it('returns {tracing: false, metrics: false} with no config and no env var',
    withCleanEnv(() => {
      const result = initializeOTel();
      expect(result).toEqual({ tracing: false, metrics: false });
    }),
  );

  it('returns {tracing: true, metrics: true} when endpoint is provided',
    withCleanEnv(() => {
      const result = initializeOTel({ endpoint: 'http://localhost:4318' });
      expect(result.tracing).toBe(true);
      expect(result.metrics).toBe(true);
    }),
  );

  it('picks up OTEL_EXPORTER_OTLP_ENDPOINT env var', async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    try {
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://test:4318';
      const result = initializeOTel();
      expect(result.tracing).toBe(true);
      expect(result.metrics).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
      } else {
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = saved;
      }
    }
  });

  it('does not throw with no arguments',
    withCleanEnv(() => {
      expect(() => initializeOTel()).not.toThrow();
    }),
  );

  it('accepts serviceName override',
    withCleanEnv(() => {
      const result = initializeOTel({
        endpoint: 'http://localhost:4318',
        serviceName: 'my-service',
      });
      expect(result.tracing).toBe(true);
    }),
  );
});

// =============================================================================
// initializeTracing / initializeMetrics (individual subsystems)
// =============================================================================

describe('OTel Provider — initializeTracing()', () => {
  afterEach(async () => {
    try { await shutdownOTel(); } catch { /* cleanup */ }
  });

  it('returns false when no endpoint configured',
    withCleanEnv(() => {
      expect(initializeTracing()).toBe(false);
    }),
  );

  it('returns true with explicit endpoint',
    withCleanEnv(() => {
      expect(initializeTracing({ endpoint: 'http://localhost:4318' })).toBe(true);
    }),
  );
});

describe('OTel Provider — initializeMetrics()', () => {
  afterEach(async () => {
    try { await shutdownOTel(); } catch { /* cleanup */ }
  });

  it('returns false when no endpoint configured',
    withCleanEnv(() => {
      expect(initializeMetrics()).toBe(false);
    }),
  );

  it('returns true with explicit endpoint',
    withCleanEnv(() => {
      expect(initializeMetrics({ endpoint: 'http://localhost:4318' })).toBe(true);
    }),
  );
});

// =============================================================================
// getTracer
// =============================================================================

describe('OTel Provider — getTracer()', () => {
  beforeAll(disableGlobalTracer);
  it('returns a valid Tracer with startSpan method', () => {
    const t = getTracer();
    expect(t).toBeDefined();
    expect(typeof t.startSpan).toBe('function');
  });

  it('returns no-op tracer when OTel is not configured', () => {
    const t = getTracer('test-tracer');
    const span = t.startSpan('no-op-test');
    expect(span).toBeDefined();
    expect(typeof span.end).toBe('function');
    const ctx = span.spanContext();
    expect(typeof ctx.traceId).toBe('string');
    span.end();
  });

  // §9 smoke test: setAttribute + isRecording must not throw; isRecording() must be false
  it('no-op span: setAttribute/isRecording do not throw; isRecording() is false', () => {
    const span = getTracer().startSpan('smoke');
    expect(() => span.setAttribute('key', 'value')).not.toThrow();
    expect(() => span.setAttribute('num', 42)).not.toThrow();
    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it('accepts a custom tracer name', () => {
    const t = getTracer('custom-component');
    expect(t).toBeDefined();
    expect(typeof t.startSpan).toBe('function');
  });

  it('default name is squad-sdk', () => {
    expect(() => getTracer()).not.toThrow();
  });
});

// =============================================================================
// _noopStartActiveSpan — arity coverage (N2)
// =============================================================================

describe('OTel Provider — noop startActiveSpan arity coverage', () => {
  beforeAll(disableGlobalTracer);
  it('(name, fn) — 2-arg form returns callback return value', () => {
    const result = getTracer().startActiveSpan('op', (_span) => 42 as number);
    expect(result).toBe(42);
  });

  it('(name, opts, fn) — 3-arg form returns callback return value', () => {
    const result = getTracer().startActiveSpan('op', {}, (_span) => 'hello' as string);
    expect(result).toBe('hello');
  });

  it('(name, opts, ctx, fn) — 4-arg form returns callback return value', () => {
    const result = getTracer().startActiveSpan('op', {}, ROOT_CONTEXT, (_span) => true as boolean);
    expect(result).toBe(true);
  });
});

// =============================================================================
// getMeter
// =============================================================================

describe('OTel Provider — getMeter()', () => {
  it('returns a valid Meter with createCounter/createHistogram', () => {
    const m = getMeter();
    expect(m).toBeDefined();
    expect(typeof m.createCounter).toBe('function');
    expect(typeof m.createHistogram).toBe('function');
  });

  it('no-op meter operations do not throw', () => {
    const m = getMeter('test-meter');
    const counter = m.createCounter('test.counter');
    expect(() => counter.add(1)).not.toThrow();
  });

  it('accepts a custom meter name', () => {
    const m = getMeter('custom-meter');
    expect(m).toBeDefined();
  });
});

// =============================================================================
// shutdownOTel
// =============================================================================

describe('OTel Provider — shutdownOTel()', () => {
  it('does not throw when nothing was initialized',
    withCleanEnv(async () => {
      await expect(shutdownOTel()).resolves.toBeUndefined();
    }),
  );

  it('is safe to call multiple times',
    withCleanEnv(async () => {
      await shutdownOTel();
      await expect(shutdownOTel()).resolves.toBeUndefined();
    }),
  );
});

// =============================================================================
// Config priority: explicit > env var > disabled
// =============================================================================

describe('OTel Provider — config priority', () => {
  afterEach(async () => {
    try { await shutdownOTel(); } catch { /* cleanup */ }
  });

  it('explicit endpoint takes precedence over env var', async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    try {
      process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://env-endpoint:4318';
      const result = initializeOTel({ endpoint: 'http://explicit:4318' });
      expect(result.tracing).toBe(true);
      expect(result.metrics).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
      } else {
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = saved;
      }
    }
  });

  it('defaults to disabled when no config or env vars',
    withCleanEnv(() => {
      const result = initializeOTel();
      expect(result.tracing).toBe(false);
      expect(result.metrics).toBe(false);
      // getTracer still returns a valid (no-op) tracer
      const t = getTracer();
      expect(t).toBeDefined();
      const span = t.startSpan('default-test');
      expect(span).toBeDefined();
      span.end();
    }),
  );
});
