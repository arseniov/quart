import { RawNode } from 'kysely';
import type { RootOperationNode } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SlowQueryPlugin,
  SlowQueryEnvSchema,
  hashParams,
  templateHash,
  type SlowQueryLogger,
  type SlowQueryClock,
} from '../../src/logger/slow-query.js';

/**
 * Build a `RawNode` whose `compileQuery()` produces a stable SQL string.
 * RawNode is the simplest valid `RootOperationNode` — the slow-query plugin
 * only needs `node` + `queryId` to do its work.
 */
function rawNode(sql: string, params: ReadonlyArray<unknown> = []): RootOperationNode {
  if (params.length === 0) {
    return RawNode.createWithSql(sql);
  }
  // Kysely's RawNode takes alternating SQL fragments + parameter nodes.
  // We don't exercise parameter binding in the tests — passing literal
  // SQL with no `?` placeholders is sufficient for the plugin to record
  // sql_chars / param_count deterministically.
  return RawNode.createWithSql(sql);
}

function mkQueryId(): { queryId: string } {
  return { queryId: `q-${Math.random().toString(36).slice(2)}` };
}

function mkOptions(opts: {
  env?: Partial<typeof SlowQueryEnvSchema._output>;
  logger?: SlowQueryLogger;
  clock?: SlowQueryClock;
  getTrace?: () => { traceId: string; spanId: string } | null;
} = {}) {
  const env = SlowQueryEnvSchema.parse(opts.env ?? {});
  const logger = opts.logger ?? { warn: vi.fn() };
  const clock = opts.clock ?? { now: () => Date.now(), hrtime: () => process.hrtime.bigint() };
  return { env, logger, clock, getTrace: opts.getTrace };
}

describe('SlowQueryEnvSchema', () => {
  it('defaults to 500ms threshold, 60s debounce, no params', () => {
    const parsed = SlowQueryEnvSchema.parse({});
    expect(parsed.SLOW_QUERY_MS).toBe(500);
    expect(parsed.SLOW_QUERY_DEBOUNCE_MS).toBe(60_000);
    expect(parsed.SLOW_QUERY_LOG_PARAMS).toBe(false);
  });

  it('coerces SLOW_QUERY_MS from string env', () => {
    expect(SlowQueryEnvSchema.parse({ SLOW_QUERY_MS: '750' }).SLOW_QUERY_MS).toBe(750);
  });

  it('rejects SLOW_QUERY_MS < 1', () => {
    expect(() => SlowQueryEnvSchema.parse({ SLOW_QUERY_MS: '0' })).toThrow();
  });

  it('rejects SLOW_QUERY_MS > 60000', () => {
    expect(() => SlowQueryEnvSchema.parse({ SLOW_QUERY_MS: '70000' })).toThrow();
  });

  it('coerces SLOW_QUERY_LOG_PARAMS="true" to true', () => {
    expect(SlowQueryEnvSchema.parse({ SLOW_QUERY_LOG_PARAMS: 'true' }).SLOW_QUERY_LOG_PARAMS).toBe(true);
    expect(SlowQueryEnvSchema.parse({ SLOW_QUERY_LOG_PARAMS: 'false' }).SLOW_QUERY_LOG_PARAMS).toBe(false);
  });

  it('accepts a boolean for SLOW_QUERY_LOG_PARAMS', () => {
    expect(SlowQueryEnvSchema.parse({ SLOW_QUERY_LOG_PARAMS: true as never }).SLOW_QUERY_LOG_PARAMS).toBe(true);
  });
});

describe('hashParams / templateHash', () => {
  it('hashParams returns a 12-char hex prefix and is deterministic', () => {
    const a = hashParams([1, 'foo']);
    const b = hashParams([1, 'foo']);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('hashParams differs when the array content changes', () => {
    expect(hashParams([1, 'foo'])).not.toBe(hashParams([2, 'foo']));
  });

  it('templateHash returns a 16-char hex prefix', () => {
    const h = templateHash('select 1');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('SlowQueryPlugin', () => {
  // The test clock advances in lockstep on both axes: each `tick(ms)`
  // moves the wall clock by `ms` and the hrtime by `ms * 1_000_000` ns.
  // Tests simulate elapsed query time by advancing the hrtime between
  // transformQuery and transformResult; the wall clock is advanced for
  // the debounce window checks.
  let clockNowMs = 0;
  let clockNowNs = 0n;
  function tick(ms: number): void {
    clockNowMs += ms;
    clockNowNs += BigInt(ms) * 1_000_000n;
  }
  const fakeClock: SlowQueryClock = {
    now: () => clockNowMs,
    hrtime: () => clockNowNs,
  };

  beforeEach(() => {
    clockNowMs = 1_000_000;
    clockNowNs = 1_000_000_000_000n;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when the elapsed time is under threshold', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 100 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });

    // Advance by 50ms (under 100ms threshold).
    tick(50);
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs at warn with duration_ms, sql_hash, sql_chars, param_count, params_hash when over threshold', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 10 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1 from t where id = ?') });
    tick(25); // 25ms > 10ms threshold
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    expect(logger.warn).toHaveBeenCalledOnce();
    const calls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const [obj, msg] = calls[0]!;
    expect(msg).toBe('slow query');
    expect(obj.slow_query).toMatchObject({
      duration_ms: 25,
      sql_chars: expect.any(Number),
      sql_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      params_hash: expect.stringMatching(/^[0-9a-f]{12}$/),
    });
    expect((obj.slow_query as Record<string, unknown>).param_count).toBe(0);
    // Raw SQL body must never appear — only the hash + char count.
    expect(JSON.stringify(obj)).not.toContain('select 1 from t where id = ?');
  });

  it('attaches trace_id + span_id when getTrace returns a span', async () => {
    const opts = mkOptions({
      env: { SLOW_QUERY_MS: 1 },
      getTrace: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    });
    const plugin = new SlowQueryPlugin({ ...opts, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
    tick(5);
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    const calls = (opts.logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const [obj] = calls[0]!;
    expect(obj.trace_id).toBe('a'.repeat(32));
    expect(obj.span_id).toBe('b'.repeat(16));
  });

  it('omits trace_id + span_id keys when no active span (OTel disabled)', async () => {
    const opts = mkOptions({
      env: { SLOW_QUERY_MS: 1 },
      getTrace: () => null,
    });
    const plugin = new SlowQueryPlugin({ ...opts, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
    tick(5);
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    const calls = (opts.logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const [obj] = calls[0]!;
    expect(obj).not.toHaveProperty('trace_id');
    expect(obj).not.toHaveProperty('span_id');
  });

  it('debounces: same template hash within window produces only one log', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1, SLOW_QUERY_DEBOUNCE_MS: 60_000 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });

    for (let i = 0; i < 3; i++) {
      const qid = mkQueryId();
      plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
      tick(10);
      await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });
    }
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('emits again after the debounce window expires (same template)', async () => {
    const { env, logger } = mkOptions({
      env: { SLOW_QUERY_MS: 1, SLOW_QUERY_DEBOUNCE_MS: 60_000 },
    });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });

    const qid1 = mkQueryId();
    plugin.transformQuery({ queryId: qid1, node: rawNode('select 1') });
    tick(10);
    await plugin.transformResult({ queryId: qid1, result: { rows: [], numAffectedRows: 0n } });

    // Advance past the debounce window.
    tick(61_000);

    const qid2 = mkQueryId();
    plugin.transformQuery({ queryId: qid2, node: rawNode('select 1') });
    tick(10);
    await plugin.transformResult({ queryId: qid2, result: { rows: [], numAffectedRows: 0n } });

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('emits separately for distinct template hashes', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1, SLOW_QUERY_DEBOUNCE_MS: 60_000 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });

    const qid1 = mkQueryId();
    plugin.transformQuery({ queryId: qid1, node: rawNode('select 1') });
    tick(10);
    await plugin.transformResult({ queryId: qid1, result: { rows: [], numAffectedRows: 0n } });

    const qid2 = mkQueryId();
    plugin.transformQuery({ queryId: qid2, node: rawNode('select 2') });
    tick(10);
    await plugin.transformResult({ queryId: qid2, result: { rows: [], numAffectedRows: 0n } });

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does not attach raw params when SLOW_QUERY_LOG_PARAMS is false (default)', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
    tick(5);
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    const calls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const [obj] = calls[0]!;
    expect(obj.slow_query).not.toHaveProperty('params');
  });

  it('attaches a sentinel `params` field when SLOW_QUERY_LOG_PARAMS is true (redact-list owned)', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1, SLOW_QUERY_LOG_PARAMS: true } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
    tick(5);
    await plugin.transformResult({ queryId: qid, result: { rows: [], numAffectedRows: 0n } });

    const calls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
    const [obj] = calls[0]!;
    // The slow-query plugin never puts raw values on `params`. The
    // sentinel string still triggers the `*.params` redaction path in
    // pino's redact list so this field is always scrubbed if a future
    // refactor accidentally attaches data here.
    expect(obj.slow_query).toHaveProperty('params');
    expect(JSON.stringify(obj)).not.toMatch(/"params"\s*:\s*\[/);
  });

  it('still returns the original query result from transformResult', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();

    plugin.transformQuery({ queryId: qid, node: rawNode('select 1') });
    tick(5);
    const result = { rows: [{ a: 1 }], numAffectedRows: 0n };
    const out = await plugin.transformResult({ queryId: qid, result });
    expect(out).toBe(result);
  });

  it('returns the result and skips logging when no pending entry exists (defensive)', async () => {
    const { env, logger } = mkOptions({ env: { SLOW_QUERY_MS: 1 } });
    const plugin = new SlowQueryPlugin({ env, logger, clock: fakeClock });
    const qid = mkQueryId();
    const result = { rows: [], numAffectedRows: 0n };
    const out = await plugin.transformResult({ queryId: qid, result });
    expect(out).toBe(result);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
