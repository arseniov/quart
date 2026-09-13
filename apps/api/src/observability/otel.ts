import { createRequire } from 'node:module';

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

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../../package.json') as { version: string };

/**
 * OTel spec for the all-zero trace id. Exported so callers + tests can
 * compare against a named constant instead of a magic 32-char string.
 * ponytail: shared across the file (1 use site) and tests; promote if more
 * callers compare against the invalid id.
 */
export const INVALID_TRACE_ID = '00000000000000000000000000000000';

/**
 * No-op shutdown handle returned when `OTEL_ENABLED=false` (or when the
 * Prometheus exporter fails to bind — see `startOtel`). Exported so tests
 * can assert identity (`expect(handle).toBe(OTEL_NOOP_HANDLE)`).
 */
export const OTEL_NOOP_HANDLE: OtelHandle = {
  shutdown: async () => {},
};

/**
 * Narrow env schema for OTel. We deliberately do NOT import the full app
 * `EnvSchema` here — workers, scripts, and the test rig may not have the
 * full surface (DB / Valkey / MinIO) but still want tracing.
 * Ponytail: T40 lesson — observability surfaces stay decoupled from app config.
 *
 * Precedence for environment name: `OTEL_ENVIRONMENT` wins, then
 * `SENTRY_ENVIRONMENT` (the deploy marker Sentry already trusts), then
 * `development`. Documented here so Sentry + OTel agree on the same label
 * without either having to import the other's schema.
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
  // Optional override — defaults to the api package.json version at module
  // init (sourced via createRequire). Drop the env override once release
  // tagging is wired through CI; keep it for emergency rollbacks.
  OTEL_SERVICE_VERSION: z.string().default(PACKAGE_VERSION),
  OTEL_EXPORTER_PROMETHEUS_HOST: z.string().default('0.0.0.0'),
  OTEL_EXPORTER_PROMETHEUS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  // 0.05 default — MVP / low-traffic. Bump via env once volume justifies.
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.05),
  // Precedence documented above; raw string so the schema doesn't need to
  // know about the Sentry env var.
  OTEL_ENVIRONMENT: z.string().default('development'),
  SENTRY_ENVIRONMENT: z.string().optional(),
});
export type OtelEnv = z.infer<typeof OtelEnvSchema>;

/**
 * Resolve the deployment environment with the documented precedence:
 * OTEL_ENVIRONMENT → SENTRY_ENVIRONMENT → 'development'. Treats empty
 * strings as "unset" so a CI job that exports `OTEL_ENVIRONMENT=` (the
 * common shell idiom for "clear this var") falls through to Sentry rather
 * than emitting a literal empty label.
 */
function resolveEnvironment(env: OtelEnv): string {
  const otel = env.OTEL_ENVIRONMENT?.trim();
  const sentry = env.SENTRY_ENVIRONMENT?.trim();
  return otel || sentry || 'development';
}

/**
 * Handle returned by `startOtel`. `shutdown()` is safe to call multiple times
 * and on a no-op handle (no SDK was started).
 */
export interface OtelHandle {
  readonly shutdown: () => Promise<void>;
}

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
 *
 * Fail-open: if the Prometheus exporter fails to bind (EADDRINUSE in dev,
 * sandbox without `listen()` permission, etc.) we log via console.error and
 * return `OTEL_NOOP_HANDLE` so the API still boots. Tracing + auto-
 * instrumentations stay live; only the metrics scrape endpoint is skipped.
 */
export function startOtel(env: OtelEnv = OtelEnvSchema.parse(process.env)): OtelHandle {
  if (!env.OTEL_ENABLED) return OTEL_NOOP_HANDLE;

  let metricReader: PrometheusExporter;
  try {
    metricReader = new PrometheusExporter({
      host: env.OTEL_EXPORTER_PROMETHEUS_HOST,
      port: env.OTEL_EXPORTER_PROMETHEUS_PORT,
    });
  } catch (err) {
    console.error('[otel] Prometheus exporter failed to bind, continuing without metrics scrape:', err);
    metricReader = new PrometheusExporter({ port: 0 });
    return OTEL_NOOP_HANDLE;
  }

  let sdk: NodeSDK;
  try {
    sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
        [ATTR_SERVICE_NAMESPACE]: env.OTEL_SERVICE_NAMESPACE,
        [ATTR_SERVICE_VERSION]: env.OTEL_SERVICE_VERSION,
        [ATTR_DEPLOYMENT_ENVIRONMENT]: resolveEnvironment(env),
      }),
      metricReader,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLER_ARG),
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs/dns instrumentations generate enormous span volume on hot
          // paths and rarely surface actionable signal — keep them off until
          // we need them. ponytail: trade sampling headroom for visibility
          // when debugging a known file-system or DNS issue; enable per-
          // instrumentation via OTEL_NODE_DISABLED_INSTRUMENTATIONS.
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
        }),
      ],
    });
    sdk.start();
  } catch (err) {
    console.error('[otel] NodeSDK init failed, continuing without tracing:', err);
    return OTEL_NOOP_HANDLE;
  }

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
 * ponytail: consumed by AuditInterceptor in T42.
 */
export function getActiveTraceContext(): { traceId: string; spanId: string } | null {
  const span = apiTrace.getActiveSpan();
  const ctx = span?.spanContext();
  if (!ctx || ctx.traceId === INVALID_TRACE_ID) return null;
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
