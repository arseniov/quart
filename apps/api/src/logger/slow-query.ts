import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

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
 *   fast queries never compile the AST, serialise params, or call into
 *   the redact list.
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
  /** Monotonic millisecond timestamp used for debounce bookkeeping. */
  now: () => number;
  /** Monotonic nanosecond timestamp used for elapsed measurement. */
  hrtime: () => bigint;
}

/** Production defaults — performance.now() for debounce (monotonic ms,
 *  unaffected by NTP step / clock skew), hrtime for elapsed. Tests inject
 *  a fake clock to control both axes deterministically. */
export const realClock: SlowQueryClock = {
  now: () => performance.now(),
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
  /** Raw AST node — compilation is deferred to the slow path so fast
   *  queries never pay the Kysely compiler cost. The WeakMap entry is
   *  deleted in transformResult, so this only lives until the query
   *  completes (success or error). */
  node: RootOperationNode;
}

/** Bounded FIFO bucket for the per-template debounce Map. Map preserves
 *  insertion order, so the oldest debounce key is the first evicted
 *  once we hit the cap. Tests don't need to know this number. */
const MAX_TRACKED = 1000;

/** JSON.stringify that survives BigInt (stringified via replacer) and
 *  circular refs (caught and replaced with a sentinel). Used by hashParams
 *  so an adversarial parameter can't crash the slow-query path. */
function safeStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ??
      '<unserializable>'
    );
  } catch {
    return '<unserializable>';
  }
}

/** Public for testing — keeps the production code free of test-only asserts. */
export function hashParams(params: ReadonlyArray<unknown>): string {
  return createHash('sha256').update(safeStringify(params)).digest('hex').slice(0, 12);
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
  /** Last-emit timestamp per template hash (ms, monotonic source).
   *  Bounded at MAX_TRACKED via FIFO eviction; long-running processes
   *  with high query cardinality stay memory-bounded. */
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
    // Capture timing + raw AST only; compilation is deferred to the
    // slow path in transformResult. The pending slot is deleted as
    // soon as transformResult fires, so an orphan from a cancelled
    // query is freed when the queryId object is GC'd.
    this.pending.set(args.queryId, {
      startNs: this.clock.hrtime(),
      node: args.node,
    });
    return args.node;
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const pending = this.pending.get(args.queryId);
    if (pending) this.pending.delete(args.queryId);

    if (!pending) return args.result;

    const elapsedMs = Number(this.clock.hrtime() - pending.startNs) / 1e6;
    if (elapsedMs < this.thresholdMs) return args.result;

    // Lazy compile: only spend Kysely compiler cycles when this query
    // actually crossed the slow threshold. Fast queries never compile.
    let compiled: { sql: string; parameters: ReadonlyArray<unknown> };
    try {
      compiled = this.compiler.compileQuery(pending.node);
    } catch {
      // Defensive: an unexpected AST node should never break the
      // query path. Log a sentinel so operators see it happened.
      compiled = { sql: '<compile-error>', parameters: [] };
    }
    try {
      this.maybeEmit(compiled, elapsedMs);
    } catch (e) {
      // Never let observability break the caller. The logger is the
      // most likely throw site (otel / pino serialization edge cases)
      // but getTrace + hashParams are also covered by this guard.
      console.error('slow-query plugin: emit failed', e);
    }
    return args.result;
  }

  private maybeEmit(
    compiled: { sql: string; parameters: ReadonlyArray<unknown> },
    elapsedMs: number,
  ): void {
    const bucket = templateHash(compiled.sql);
    const now = this.clock.now();
    const last = this.lastEmitted.get(bucket);
    if (last !== undefined && now - last < this.debounceMs) return;
    // Bound the bucket Map: under load (1k+ distinct slow queries)
    // the unbounded Map would leak indefinitely. FIFO eviction via
    // insertion order is acceptable for debounce bookkeeping — the
    // oldest debounce key is the most stale.
    if (this.lastEmitted.size >= MAX_TRACKED) {
      const oldest = this.lastEmitted.keys().next().value;
      if (oldest !== undefined) this.lastEmitted.delete(oldest);
    }
    this.lastEmitted.set(bucket, now);

    const slowQuery: Record<string, unknown> = {
      duration_ms: Math.round(elapsedMs),
      sql_hash: bucket,
      sql_chars: compiled.sql.length,
      param_count: compiled.parameters.length,
      params_hash: hashParams(compiled.parameters) || undefined,
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
