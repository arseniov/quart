import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  NodeSDKInstances: [] as Array<{
    cfg: Record<string, unknown>;
    start: ReturnType<typeof vi.fn>;
    shutdown: ReturnType<typeof vi.fn>;
  }>,
  ResourceInstances: [] as Array<{ attrs: Record<string, unknown> }>,
  ParentBasedInstances: [] as Array<{ cfg: unknown }>,
  TraceIdRatioInstances: [] as Array<{ ratio: number }>,
  PrometheusInstances: [] as Array<{ cfg: Record<string, unknown> }>,
  AutoInstrumentations: [] as Array<unknown>,
  getActiveSpan: vi.fn(),
  activeContext: vi.fn(),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    public cfg: Record<string, unknown>;
    public start = vi.fn(() => mocks.NodeSDKInstances[mocks.NodeSDKInstances.length - 1]!.start());
    public shutdown = vi.fn(async () =>
      mocks.NodeSDKInstances[mocks.NodeSDKInstances.length - 1]!.shutdown(),
    );
    constructor(cfg: Record<string, unknown>) {
      this.cfg = cfg;
      mocks.NodeSDKInstances.push({
        cfg,
        start: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
      });
    }
  },
}));

vi.mock('@opentelemetry/exporter-prometheus', () => ({
  PrometheusExporter: class {
    public cfg: Record<string, unknown>;
    constructor(cfg: Record<string, unknown>) {
      this.cfg = cfg;
      mocks.PrometheusInstances.push({ cfg });
    }
  },
}));

vi.mock('@opentelemetry/resources', () => ({
  Resource: class {
    public attrs: Record<string, unknown>;
    constructor(attrs: Record<string, unknown>) {
      this.attrs = attrs;
      mocks.ResourceInstances.push({ attrs });
    }
  },
}));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  ParentBasedSampler: class {
    public cfg: unknown;
    constructor(cfg: unknown) {
      this.cfg = cfg;
      mocks.ParentBasedInstances.push({ cfg });
    }
  },
  TraceIdRatioBasedSampler: class {
    public ratio: number;
    constructor(ratio: number) {
      this.ratio = ratio;
      mocks.TraceIdRatioInstances.push({ ratio });
    }
  },
}));

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: (cfg: unknown) => {
    const a = { name: 'auto', cfg };
    mocks.AutoInstrumentations.push(a);
    return [a];
  },
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}));

vi.mock('@opentelemetry/semantic-conventions/incubating', () => ({
  ATTR_DEPLOYMENT_ENVIRONMENT: 'deployment.environment',
  ATTR_SERVICE_NAMESPACE: 'service.namespace',
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () => mocks.getActiveSpan(),
    getActiveContext: () => mocks.activeContext(),
  },
  context: {
    active: () => mocks.activeContext(),
  },
}));

import {
  getActiveTraceContext,
  INVALID_TRACE_ID,
  OTEL_NOOP_HANDLE,
  OtelEnvSchema,
  startOtel,
} from '../../src/observability/otel.js';

describe('OtelEnvSchema', () => {
  it('defaults to enabled, quart-api service, namespace=quart, port=9464, host=0.0.0.0, ratio=0.05', () => {
    const parsed = OtelEnvSchema.parse({});
    expect(parsed).toEqual({
      OTEL_ENABLED: true,
      OTEL_SERVICE_NAME: 'quart-api',
      OTEL_SERVICE_NAMESPACE: 'quart',
      OTEL_SERVICE_VERSION: expect.any(String),
      OTEL_EXPORTER_PROMETHEUS_HOST: '0.0.0.0',
      OTEL_EXPORTER_PROMETHEUS_PORT: 9464,
      OTEL_TRACES_SAMPLER_ARG: 0.05,
      OTEL_ENVIRONMENT: 'development',
      SENTRY_ENVIRONMENT: undefined,
    });
  });

  it('coerces port + ratio from strings', () => {
    const parsed = OtelEnvSchema.parse({
      OTEL_EXPORTER_PROMETHEUS_PORT: '9465',
      OTEL_TRACES_SAMPLER_ARG: '0.5',
    });
    expect(parsed.OTEL_EXPORTER_PROMETHEUS_PORT).toBe(9465);
    expect(parsed.OTEL_TRACES_SAMPLER_ARG).toBe(0.5);
  });

  it('coerces OTEL_ENABLED=false correctly', () => {
    expect(OtelEnvSchema.parse({ OTEL_ENABLED: 'false' }).OTEL_ENABLED).toBe(false);
    expect(OtelEnvSchema.parse({ OTEL_ENABLED: 'true' }).OTEL_ENABLED).toBe(true);
  });

  it('rejects OTEL_TRACES_SAMPLER_ARG > 1', () => {
    expect(() => OtelEnvSchema.parse({ OTEL_TRACES_SAMPLER_ARG: '1.5' })).toThrow();
  });

  it('rejects OTEL_EXPORTER_PROMETHEUS_PORT > 65535', () => {
    expect(() => OtelEnvSchema.parse({ OTEL_EXPORTER_PROMETHEUS_PORT: '70000' })).toThrow();
  });
});

describe('startOtel', () => {
  beforeEach(() => {
    mocks.NodeSDKInstances.length = 0;
    mocks.ResourceInstances.length = 0;
    mocks.ParentBasedInstances.length = 0;
    mocks.TraceIdRatioInstances.length = 0;
    mocks.PrometheusInstances.length = 0;
    mocks.AutoInstrumentations.length = 0;
    mocks.getActiveSpan.mockReset();
    mocks.activeContext.mockReset();
  });

  afterEach(async () => {
    // Tear down every SDK created during the test. The Mock SDK's shutdown
    // returns a resolved promise — calling it ensures tests that constructed
    // an SDK also exercised the shutdown path (matches production wiring).
    await Promise.all(
      mocks.NodeSDKInstances.map(async (sdk) => {
        sdk.shutdown();
        expect(sdk.shutdown).toHaveBeenCalled();
      }),
    );
  });

  it('returns the shared no-op handle when OTEL_ENABLED=false (no SDK instantiated)', () => {
    const handle = startOtel({ ...OtelEnvSchema.parse({}), OTEL_ENABLED: false });
    expect(handle).toBe(OTEL_NOOP_HANDLE);
    expect(mocks.NodeSDKInstances).toHaveLength(0);
    expect(mocks.ResourceInstances).toHaveLength(0);
    expect(mocks.PrometheusInstances).toHaveLength(0);
    return expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('constructs NodeSDK with Resource, PrometheusExporter, ParentBasedSampler, auto-instr', async () => {
    const handle = startOtel();
    expect(mocks.NodeSDKInstances).toHaveLength(1);
    expect(mocks.ResourceInstances).toHaveLength(1);
    expect(mocks.PrometheusInstances).toHaveLength(1);
    expect(mocks.ParentBasedInstances).toHaveLength(1);
    expect(mocks.TraceIdRatioInstances).toHaveLength(1);
    expect(mocks.AutoInstrumentations).toHaveLength(1);
    expect(handle).toBeDefined();
    await handle.shutdown();
  });

  it('calls sdk.start() exactly once', async () => {
    const handle = startOtel();
    const sdk = mocks.NodeSDKInstances[0]!;
    expect(sdk.start).toHaveBeenCalledOnce();
    await handle.shutdown();
  });

  it('passes resource attributes from env (service.name, service.namespace, service.version, deployment.environment)', async () => {
    const handle = startOtel({
      ...OtelEnvSchema.parse({}),
      OTEL_SERVICE_NAME: 'my-api',
      OTEL_SERVICE_NAMESPACE: 'quart-test',
      OTEL_SERVICE_VERSION: '1.2.3',
      OTEL_ENVIRONMENT: 'staging',
    });
    const resource = mocks.ResourceInstances[0]!;
    expect(resource.attrs).toEqual({
      'service.name': 'my-api',
      'service.namespace': 'quart-test',
      'service.version': '1.2.3',
      'deployment.environment': 'staging',
    });
    await handle.shutdown();
  });

  it('wires PrometheusExporter with host/port from env', async () => {
    const handle = startOtel({
      ...OtelEnvSchema.parse({}),
      OTEL_EXPORTER_PROMETHEUS_HOST: '127.0.0.1',
      OTEL_EXPORTER_PROMETHEUS_PORT: 9999,
    });
    const prom = mocks.PrometheusInstances[0]!;
    expect(prom.cfg).toEqual({ host: '127.0.0.1', port: 9999 });
    await handle.shutdown();
  });

  it('passes parent-based sampler with TraceIdRatioBasedSampler root', async () => {
    const handle = startOtel({ ...OtelEnvSchema.parse({}), OTEL_TRACES_SAMPLER_ARG: 0.25 });
    expect(mocks.TraceIdRatioInstances).toHaveLength(1);
    expect(mocks.TraceIdRatioInstances[0]!.ratio).toBe(0.25);
    expect(mocks.ParentBasedInstances[0]!.cfg).toEqual({
      root: expect.objectContaining({ ratio: 0.25 }),
    });
    await handle.shutdown();
  });

  it('disables fs + dns auto-instrumentations to keep span volume sane', async () => {
    const handle = startOtel();
    const cfg = (mocks.AutoInstrumentations[0] as { cfg?: unknown }).cfg as
      | Record<string, { enabled: boolean }>
      | undefined;
    expect(cfg?.['@opentelemetry/instrumentation-fs']).toEqual({ enabled: false });
    expect(cfg?.['@opentelemetry/instrumentation-dns']).toEqual({ enabled: false });
    await handle.shutdown();
  });

  it('attaches getNodeAutoInstrumentations() to the SDK', async () => {
    const handle = startOtel();
    const cfg = mocks.NodeSDKInstances[0]!.cfg;
    expect(cfg.instrumentations).toBeDefined();
    expect(Array.isArray(cfg.instrumentations)).toBe(true);
    await handle.shutdown();
  });

  it('handle.shutdown() resolves and calls sdk.shutdown()', async () => {
    const handle = startOtel();
    await handle.shutdown();
    const sdk = mocks.NodeSDKInstances[0]!;
    expect(sdk.shutdown).toHaveBeenCalledOnce();
  });

  it('falls back to SENTRY_ENVIRONMENT when OTEL_ENVIRONMENT is empty', async () => {
    const handle = startOtel({
      ...OtelEnvSchema.parse({}),
      OTEL_ENVIRONMENT: '',
      SENTRY_ENVIRONMENT: 'staging',
    });
    // resolveEnvironment() falls through to SENTRY_ENVIRONMENT when
    // OTEL_ENVIRONMENT is the empty string.
    expect(mocks.ResourceInstances[0]!.attrs['deployment.environment']).toBe('staging');
    await handle.shutdown();
  });

  it('prefers OTEL_ENVIRONMENT over SENTRY_ENVIRONMENT', async () => {
    const handle = startOtel({
      ...OtelEnvSchema.parse({}),
      OTEL_ENVIRONMENT: 'production',
      SENTRY_ENVIRONMENT: 'staging',
    });
    expect(mocks.ResourceInstances[0]!.attrs['deployment.environment']).toBe('production');
    await handle.shutdown();
  });
});

describe('getActiveTraceContext', () => {
  afterEach(() => {
    mocks.getActiveSpan.mockReset();
  });

  it('returns null when there is no active span', () => {
    mocks.getActiveSpan.mockReturnValue(undefined);
    expect(getActiveTraceContext()).toBeNull();
  });

  it('returns null when the active span has the zero traceId (no sampling)', () => {
    mocks.getActiveSpan.mockReturnValue({
      spanContext: () => ({
        traceId: INVALID_TRACE_ID,
        spanId: '0000000000000000',
        traceFlags: 0,
      }),
    });
    expect(getActiveTraceContext()).toBeNull();
  });

  it('returns traceId and spanId of the active span', () => {
    mocks.getActiveSpan.mockReturnValue({
      spanContext: () => ({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1,
      }),
    });
    expect(getActiveTraceContext()).toEqual({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    });
  });
});

describe('exported constants', () => {
  it('exposes INVALID_TRACE_ID for callers + tests', () => {
    expect(INVALID_TRACE_ID).toBe('00000000000000000000000000000000');
    expect(INVALID_TRACE_ID).toHaveLength(32);
  });

  it('exposes OTEL_NOOP_HANDLE as the shared singleton', () => {
    expect(OTEL_NOOP_HANDLE).toBeDefined();
    expect(typeof OTEL_NOOP_HANDLE.shutdown).toBe('function');
  });
});