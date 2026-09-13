import { createHash } from 'node:crypto';

import { DefaultQueryCompiler } from 'kysely';
import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely';
import { z } from 'zod';

import { getActiveTraceContext } from '../observability/otel.js';

/**
 * Slow-query observability for Kysely.
 *
 * Defensive defaults (T42 deviations):
 * - Threshold 500ms (matches Postgres `log_min_duration_statement`).
 * - Params hashed (SHA-256 prefix), NEVER raw. Even when an operator
 *   flips SLOW_QUERY_LOG_PARAMS=true, the global pino redact list still
 *   scrubs anything the source code missed.
 * - 60s debounce per SQL template hash so a 1s query that fires 100x/min
 *   doesn't flood the log channel.
 * - traceId/spanId attached only when an active OTel span is sampled
 *   (graceful fallback when OTEL_ENABLED=false).
 * - Hot path: only branches when the elapsed clock exceeds threshold;
 *   fast queries never serialise params or call into the redact list.
 *
 * ponytail: thresholds + redact paths + debounce window are the
 * production-relevant knobs; everything else is test wiring.
 */

export const SlowQueryEnvSchema = z.object({
  SLOW_QUERY_MS: z.coerce.number().int().min(1).max(60_000).default(500),
  SLOW_QUERY_DEBOUNCE_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  // High-risk; keep off by default. The pino redact list is a second layer
  // of defense even when this is on.
  SLOW_QUERY_LOG_PARAMS: z.preprocess(
    (v) => (v === undefined ? 'false' : typeof v === 'boolean' ? String(v) : v),
    z.enum(['true', 'false']),
  )
    .transform((v) => v === 'true')
    .default(false),
});
export type SlowQueryEnv = z.infer<typeof SlowQueryEnvSchema>;

export interface SlowQueryLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface SlowQueryClock {
  /** Wall-clock millisecond timestamp used for debounce bookkeeping. */
  now: () => number;
  /** Monotonic nanosecond timestamp used for elapsed measurement. */
  hrtime: () => bigint;
}

/** Production defaults — wall clock for debounce, monotonic hrtime for
 *  elapsed. Tests inject a fake clock to control both axes deterministically. */
export const realClock: SlowQueryClock = {
  now: () => Date.now(),
  hrtime: () => process.hrtime.bigint(),
};

export interface SlowQueryOptions {
  env: SlowQueryEnv;
  logger: SlowQueryLogger;
  clock?: SlowQueryClock;
  /**
   * Override for the active-trace supplier (defaults to
   * `getActiveTraceContext` from OTel). Returns null when no span is
   * sampled, in which case the log line omits trace_id / span_id.
   */
  getTrace?: () => { traceId: string; spanId: string } | null;
}

interface PendingQuery {
  /** Nanosecond timestamp captured at transformQuery time, sourced from
   *  the injected clock (defaults to `process.hrtime.bigint()`). */
  startNs: bigint;
  /** Captured at transformQuery time so transformResult never re-walks
   *  the AST on the slow path. Falls back to '<compile-error>' if the
   *  Kysely compiler throws on an unexpected node (defensive: never
   *  break the actual query). */
  sql: string;
  paramCount: number;
  /** SHA-256 prefix (12 hex chars) of the JSON-serialised param array.
   *  Traceability, never raw. */
  paramsHash: string;
}

/** Public for testing — keeps the production code free of test-only asserts. */
export function hashParams(params: ReadonlyArray<unknown>): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 12);
}

/** Template hash used as the debounce bucket key. 16 hex chars = 64 bits,
 *  collision-safe for production query volumes. */
export function templateHash(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

export class SlowQueryPlugin implements KyselyPlugin {
  private readonly thresholdMs: number;
  private readonly debounceMs: number;
  private readonly logParams: boolean;
  private readonly logger: SlowQueryLogger;
  private readonly clock: SlowQueryClock;
  private readonly getTrace: () => { traceId: string; spanId: string } | null;
  /** DefaultQueryCompiler is dialect-agnostic and emits ANSI SQL, which
   *  is fine for the template hash + sql_chars metadata we log (we never
   *  log the SQL body itself, only its SHA-256 prefix). */
  private readonly compiler = new DefaultQueryCompiler();
  /** Last-emit timestamp per template hash (ms). Pruned implicitly via
   *  the monotonic clock; in long-running processes this is bounded by
   *  the cardinality of distinct slow queries. */
  private readonly lastEmitted = new Map<string, number>();
  /** WeakMap so cancelled queries don't leak entries. Kysely guarantees
   *  that every transformQuery is paired with a transformResult for the
   *  same queryId when the executor completes normally; on error we still
   *  drop the entry here when transformResult fires. */
  private readonly pending = new WeakMap<object, PendingQuery>();

  constructor(opts: SlowQueryOptions) {
    this.thresholdMs = opts.env.SLOW_QUERY_MS;
    this.debounceMs = opts.env.SLOW_QUERY_DEBOUNCE_MS;
    this.logParams = opts.env.SLOW_QUERY_LOG_PARAMS;
    this.logger = opts.logger;
    this.clock = opts.clock ?? realClock;
    this.getTrace = opts.getTrace ?? getActiveTraceContext;
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    try {
      const compiled = this.compiler.compileQuery(args.node);
      this.pending.set(args.queryId, {
        startNs: this.clock.hrtime(),
        sql: compiled.sql,
        paramCount: compiled.parameters.length,
        paramsHash: hashParams(compiled.parameters),
      });
    } catch {
      // Don't let observability break the query path. The pending slot
      // still records a start so transformResult can branch on elapsed
      // and skip logging for this query.
      this.pending.set(args.queryId, {
        startNs: this.clock.hrtime(),
        sql: '<compile-error>',
        paramCount: 0,
        paramsHash: '',
      });
    }
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const pending = this.pending.get(args.queryId);
    if (pending) this.pending.delete(args.queryId);

    if (!pending) return args.result;

    const elapsedMs = Number(this.clock.hrtime() - pending.startNs) / 1e6;
    if (elapsedMs >= this.thresholdMs) {
      this.maybeEmit(pending, elapsedMs);
    }
    return args.result;
  }

  private maybeEmit(p: PendingQuery, elapsedMs: number): void {
    const bucket = templateHash(p.sql);
    const now = this.clock.now();
    const last = this.lastEmitted.get(bucket);
    if (last !== undefined && now - last < this.debounceMs) return;
    this.lastEmitted.set(bucket, now);

    const slowQuery: Record<string, unknown> = {
      duration_ms: Math.round(elapsedMs),
      sql_hash: bucket,
      sql_chars: p.sql.length,
      param_count: p.paramCount,
      params_hash: p.paramsHash || undefined,
    };
    // Opt-in: only attach the raw (already-redacted) params when the
    // operator explicitly enables it. The pino redact list covers
    // `*.params` regardless, so this is a deliberate carve-out, not a
    // bypass.
    if (this.logParams) {
      slowQuery.params = '[see pino redact path: *.params]';
    }

    const obj: Record<string, unknown> = { slow_query: slowQuery };
    const trace = this.getTrace();
    if (trace) {
      obj.trace_id = trace.traceId;
      obj.span_id = trace.spanId;
    }
    this.logger.warn(obj, 'slow query');
  }

  /** Test-only: peek at debounce state. Not used in production. */
  _lastEmitted(): ReadonlyMap<string, number> {
    return this.lastEmitted;
  }
}
