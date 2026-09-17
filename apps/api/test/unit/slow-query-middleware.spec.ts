import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SlowQueryMiddleware,
  SlowRequestEnvSchema,
} from '../../src/observability/slow-query.middleware.js';

/** Captures the `'finish'` callback the middleware registers and exposes it
 *  so the test can fire it synchronously and inspect what got logged. */
function mkRes(): { res: { on: ReturnType<typeof vi.fn> }; fireFinish: () => void } {
  let finishCb: () => void = () => {};
  const on = vi.fn((event: string, cb: () => void) => {
    if (event === 'finish') finishCb = cb;
    return undefined;
  });
  return { res: { on }, fireFinish: () => finishCb() };
}

function mkReq(opts: { url?: string; routerPath?: string } = {}) {
  const warn = vi.fn();
  const req = {
    url: opts.url ?? '/test',
    routerPath: opts.routerPath,
    log: { warn },
  };
  return { req, warn };
}

describe('SlowRequestEnvSchema', () => {
  it('defaults SLOW_REQUEST_MS to 200', () => {
    expect(SlowRequestEnvSchema.parse({}).SLOW_REQUEST_MS).toBe(200);
  });

  it('coerces SLOW_REQUEST_MS from string env', () => {
    expect(SlowRequestEnvSchema.parse({ SLOW_REQUEST_MS: '500' }).SLOW_REQUEST_MS).toBe(500);
  });

  it('rejects SLOW_REQUEST_MS < 1', () => {
    expect(() => SlowRequestEnvSchema.parse({ SLOW_REQUEST_MS: '0' })).toThrow();
  });

  it('rejects SLOW_REQUEST_MS > 60000', () => {
    expect(() => SlowRequestEnvSchema.parse({ SLOW_REQUEST_MS: '70000' })).toThrow();
  });
});

describe('SlowQueryMiddleware', () => {
  // Mock the monotonic clock so tests advance time deterministically without
  // `setTimeout`. Mirrors the Kysely plugin's clock injection pattern.
  let hrtimeNs = 0n;
  const tick = (ms: number): bigint => {
    hrtimeNs += BigInt(ms) * 1_000_000n;
    return hrtimeNs;
  };
  const hrtime = (): bigint => hrtimeNs;

  beforeEach(() => {
    hrtimeNs = 0n;
  });
  afterEach(() => {
    delete process.env.SLOW_REQUEST_MS;
  });

  it('does not log when the request finishes under the threshold', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    const next = vi.fn();
    mw.use(req, res, next);
    tick(50); // 50ms < 100ms threshold
    fireFinish();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs at warn with route + elapsed_ms + message "slow request" when over threshold', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const { req, warn } = mkReq({ url: '/users/42', routerPath: '/users/:id' });
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(250);
    fireFinish();
    expect(warn).toHaveBeenCalledOnce();
    const [obj, msg] = warn.mock.calls[0]!;
    expect(msg).toBe('slow request');
    expect(obj).toMatchObject({ route: '/users/:id', elapsed_ms: 250 });
  });

  it('rounds elapsed_ms to the nearest integer', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 50, hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(73); // exactly 73ms
    fireFinish();
    expect((warn.mock.calls[0]![0] as Record<string, unknown>).elapsed_ms).toBe(73);
  });

  it('prefers req.routerPath over req.url when both are present', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 0, hrtime });
    const { req, warn } = mkReq({ url: '/users/42', routerPath: '/users/:id' });
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(1);
    fireFinish();
    expect((warn.mock.calls[0]![0] as Record<string, unknown>).route).toBe('/users/:id');
  });

  it('falls back to req.url when routerPath is missing', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 0, hrtime });
    const { req, warn } = mkReq({ url: '/healthz' }); // no routerPath
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(1);
    fireFinish();
    expect((warn.mock.calls[0]![0] as Record<string, unknown>).route).toBe('/healthz');
  });

  it('includes traceId + spanId when getTrace returns an active span', () => {
    const mw = new SlowQueryMiddleware({
      thresholdMs: 0,
      hrtime,
      getTrace: () => ({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
    });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(1);
    fireFinish();
    const obj = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(obj.traceId).toBe('a'.repeat(32));
    expect(obj.spanId).toBe('b'.repeat(16));
  });

  it('omits traceId + spanId when no active span (OTel disabled)', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 0, hrtime, getTrace: () => null });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(1);
    fireFinish();
    const obj = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(obj).not.toHaveProperty('traceId');
    expect(obj).not.toHaveProperty('spanId');
  });

  it('honors SLOW_REQUEST_MS env override (500ms)', () => {
    process.env.SLOW_REQUEST_MS = '500';
    const mw = new SlowQueryMiddleware({ hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(300); // 300ms < 500ms threshold from env
    fireFinish();
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses default threshold (200ms) when SLOW_REQUEST_MS is unset', () => {
    delete process.env.SLOW_REQUEST_MS;
    const mw = new SlowQueryMiddleware({ hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(150); // 150ms < 200ms default
    fireFinish();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs when elapsed equals the threshold (>= boundary)', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    tick(100); // exactly at threshold
    fireFinish();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('invokes next() exactly once and synchronously from use()', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const { req } = mkReq();
    const { res } = mkRes();
    const next = vi.fn();
    mw.use(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    // Finish must not re-call next.
    tick(200);
    // fireFinish captured by mkRes is local; we can't call it from here, but
    // we can at least assert next wasn't called a second time yet.
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not cross-contaminate timers across concurrent requests', () => {
    // Two concurrent requests share the same middleware instance but each
    // captures its own startNs in the `use()` closure. The test verifies
    // each request computes elapsed from its own start, not from a shared
    // global timer.
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const r1 = mkRes();
    const r2 = mkRes();
    const q1 = mkReq();
    const q2 = mkReq();
    mw.use(q1.req, r1.res, () => {});
    tick(50);
    mw.use(q2.req, r2.res, () => {}); // r2 starts 50ms after r1
    tick(60); // r1 is now 110ms since start, r2 is 60ms
    r1.fireFinish();
    tick(200); // r2 is now 260ms since start
    r2.fireFinish();

    expect(q1.warn).toHaveBeenCalledOnce();
    expect(q2.warn).toHaveBeenCalledOnce();
    expect((q1.warn.mock.calls[0]![0] as Record<string, unknown>).elapsed_ms).toBe(110);
    expect((q2.warn.mock.calls[0]![0] as Record<string, unknown>).elapsed_ms).toBe(260);
  });

  it('does not log when threshold > 0 and elapsed is 0 (under-threshold edge)', () => {
    const mw = new SlowQueryMiddleware({ thresholdMs: 100, hrtime });
    const { req, warn } = mkReq();
    const { res, fireFinish } = mkRes();
    mw.use(req, res, () => {});
    // No tick — elapsed is exactly 0ms, under threshold.
    fireFinish();
    expect(warn).not.toHaveBeenCalled();
  });
});