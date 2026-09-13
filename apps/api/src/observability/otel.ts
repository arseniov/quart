import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { trace as apiTrace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_SERVICE_NAMESPACE,
} from '@opentelemetry/semantic-conventions/incubating';
import { z } from 'zod';

/**
 * Narrow env schema for OTel. We deliberately do NOT import the full app
 * `EnvSchema` here — workers, scripts, and the test rig may not have the
 * full surface (DB / Valkey / MinIO) but still want tracing.
 * Ponytail: T40 lesson — observability surfaces stay decoupled from app config.
 */
export const OtelEnvSchema = z.object({
  // Accept both boolean (from in-process callers) and string (from process.env)
  // so the schema can be parsed against either source.
  OTEL_ENABLED: z.preprocess(
    (v) => (v === undefined ? 'true' : typeof v === 'boolean' ? String(v) : v),
    z.enum(['true', 'false']),
  ).transform((v) => v === 'true').default(true),
  OTEL_SERVICE_NAME: z.string().default('quart-api'),
  OTEL_SERVICE_NAMESPACE: z.string().default('quart'),
  OTEL_SERVICE_VERSION: z.string().default('0.0.0'),
  OTEL_EXPORTER_PROMETHEUS_HOST: z.string().default('0.0.0.0'),
  OTEL_EXPORTER_PROMETHEUS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.1),
  OTEL_ENVIRONMENT: z.string().default('development'),
});
export type OtelEnv = z.infer<typeof OtelEnvSchema>;

/**
 * Handle returned by `startOtel`. `shutdown()` is safe to call multiple times
 * and on a no-op handle (no SDK was started).
 */
export interface OtelHandle {
  readonly shutdown: () => Promise<void>;
}

const NOOP_HANDLE: OtelHandle = {
  shutdown: async () => {},
};

/**
 * Initialize the OpenTelemetry NodeSDK with the Prometheus exporter and
 * auto-instrumentations. No-op when `OTEL_ENABLED=false`.
 *
 * Lifecycle:
 * - Returns an `OtelHandle` whose `shutdown()` flushes spans + metrics and
 *   stops the Prometheus exporter HTTP server.
 * - Caller wires `shutdown()` to Nest's `OnApplicationShutdown` AND
 *   `process.on('SIGTERM')` for the hard-stop path.
 *
 * SDK packages are statically imported (zero-cost when disabled — NodeSDK
 * constructor never runs and no instrumentations are loaded). The
 * `OTEL_ENABLED=false` gate is the lazy boundary.
 */
export function startOtel(env: OtelEnv = OtelEnvSchema.parse(process.env)): OtelHandle {
  if (!env.OTEL_ENABLED) return NOOP_HANDLE;

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
      [ATTR_SERVICE_NAMESPACE]: env.OTEL_SERVICE_NAMESPACE,
      [ATTR_SERVICE_VERSION]: env.OTEL_SERVICE_VERSION,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: env.OTEL_ENVIRONMENT,
    }),
    metricReader: new PrometheusExporter({
      host: env.OTEL_EXPORTER_PROMETHEUS_HOST,
      port: env.OTEL_EXPORTER_PROMETHEUS_PORT,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLER_ARG),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return {
    async shutdown() {
      await sdk.shutdown();
    },
  };
}

/**
 * Return the active span's traceId/spanId, or null when there is no
 * sampled/active span. Used by the audit interceptor + logging to attach
 * `trace_id` / `span_id` to events without going through the OTel SDK.
 */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  const span = apiTrace.getActiveSpan();
  const ctx = span?.spanContext();
  if (!ctx || ctx.traceId === '00000000000000000000000000000000') return null;
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/**
 * Nest provider that closes the OTel SDK on `OnApplicationShutdown`. The
 * handle is set from `main.ts` AFTER `startOtel()` runs and AFTER
 * `NestFactory.create()` returns, so we can register a Nest lifecycle hook
 * for a non-Nest singleton without using module-level globals.
 *
 * Ponytail: a single setter is the smallest wiring that keeps shutdown on
 * the same code path as `enableShutdownHooks()` (Sentry / QueueService
 * already use the same pattern).
 */
@Injectable()
export class OtelShutdownHook implements OnApplicationShutdown {
  private handle: OtelHandle | null = null;

  setHandle(handle: OtelHandle): void {
    this.handle = handle;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.handle) await this.handle.shutdown();
  }
}