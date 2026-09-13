import { Injectable, type NestMiddleware, Optional } from '@nestjs/common';
import { z } from 'zod';

import { getActiveTraceContext } from './otel.js';

/**
 * Narrow env schema for the HTTP request slow-log middleware. Deliberately
 * decoupled from the full app `EnvSchema` so workers / scripts / test rigs
 * can boot without DB / Valkey / MinIO config and still get request timing.
 *
 * ponytail: T40/T41 lesson — observability surfaces stay decoupled from
 * app config; default matches the spec (`SLOW_REQUEST_MS=200`) so production
 * needs no env wiring.
 */
export const SlowRequestEnvSchema = z.object({
  SLOW_REQUEST_MS: z.coerce.number().int().min(1).max(60_000).default(200),
});
export type SlowRequestEnv = z.infer<typeof SlowRequestEnvSchema>;

/** Trace-context supplier contract — same shape as `getActiveTraceContext`. */
export type TraceSupplier = () => { traceId: string; spanId: string } | null;

/** Monotonic nanosecond clock contract — same shape as `process.hrtime.bigint`. */
export type HrTimeSupplier = () => bigint;

/**
 * Minimal request surface the middleware reads. `req.log` is the
 * request-scoped pino child that nestjs-pino attaches on Fastify.
 * `req.routerPath` is the matched route template (e.g. `/users/:id`);
 * `req.url` is the raw request URL.
 */
interface SlowRequest {
  url: string;
  routerPath?: string;
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
}

/** Minimal response surface — only `on('finish', cb)` is needed. */
interface SlowResponse {
  on(event: 'finish', cb: () => void): unknown;
}

export interface SlowQueryMiddlewareOptions {
  /** Override the parsed env threshold. Production passes nothing. */
  thresholdMs?: number;
  /** Override the trace-context supplier (default `getActiveTraceContext`). */
  getTrace?: TraceSupplier;
  /** Override the monotonic clock (default `process.hrtime.bigint`). */
  hrtime?: HrTimeSupplier;
}

/**
 * HTTP request slow-log middleware. Captures a monotonic timer on entry,
 * hooks `res.on('finish')`, and logs a `warn` line when elapsed ≥ the
 * configured threshold (default 200ms — plan T42).
 *
 * No blocking, no async work: the finish callback only branches and
 * allocates the log object when over threshold. `next()` is invoked
 * synchronously from `use()` so request handling is not deferred.
 *
 * Timer is scoped per request via the closure — concurrent requests do
 * not share start state.
 */
@Injectable()
export class SlowQueryMiddleware implements NestMiddleware {
  private readonly thresholdMs: number;
  private readonly getTrace: TraceSupplier;
  private readonly hrtime: HrTimeSupplier;

  constructor(@Optional() opts: SlowQueryMiddlewareOptions = {}) {
    const env = SlowRequestEnvSchema.parse(process.env);
    this.thresholdMs = opts.thresholdMs ?? env.SLOW_REQUEST_MS;
    this.getTrace = opts.getTrace ?? getActiveTraceContext;
    this.hrtime = opts.hrtime ?? (() => process.hrtime.bigint());
  }

  use(req: SlowRequest, res: SlowResponse, next: () => void): void {
    const startNs = this.hrtime();
    res.on('finish', () => {
      const elapsedMs = Number(this.hrtime() - startNs) / 1e6;
      if (elapsedMs < this.thresholdMs) return;
      const trace = this.getTrace();
      req.log.warn(
        {
          route: req.routerPath ?? req.url,
          elapsed_ms: Math.round(elapsedMs),
          ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
        },
        'slow request',
      );
    });
    next();
  }
}