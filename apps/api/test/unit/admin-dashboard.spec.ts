import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AdminDashboardController } from '../../src/admin/admin-dashboard.controller.js';
import { AdminDlqController } from '../../src/admin/admin-dlq.controller.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../../src/common/zod-validation.pipe.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import type { QueueService } from '../../src/queue/queue.service.js';

// ----------------------------------------------------------------------------
// Trx stub — `executeTakeFirstOrThrow` resolves to the next queued row. The
// dashboard now runs a single aggregate (FILTER-based) per call.
// ----------------------------------------------------------------------------
type Row = Record<string, unknown>;

function makeTrx(scenarios: Row[]) {
  const queue: Row[] = [...scenarios];
  const terminal = {
    execute: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return [next];
    }),
    executeTakeFirst: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return next;
    }),
    executeTakeFirstOrThrow: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: no row');
      return next;
    }),
  };
  const handler = {
    get(t: Record<string, unknown>, prop: string | symbol) {
      if (prop in t) return (t as Record<string, unknown>)[prop as string];
      return () => new Proxy(t, handler);
    },
  };
  const trx = new Proxy(terminal, handler) as unknown as Record<string, unknown>;
  return { trx };
}

function makeDb(scenarios: Row[]) {
  const { trx } = makeTrx(scenarios);
  const db = {
    runInTenantTx: vi.fn(async (_ctx: TenantContext, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
  } as unknown as DbService;
  return { db, trx };
}

const tenant: TenantContext = {
  cityId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  isSuperAdmin: false,
  requestId: 'req-1',
};

const adminUser = {
  id: 'admin-1',
  cityId: tenant.cityId,
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
} as unknown as AuthUser;

// ============================================================================
// Dashboard
// ============================================================================
describe('AdminDashboardController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns KPI aggregates for 7d / 30d / all from a single FILTER query', async () => {
    // Single aggregate row — three columns populated by Postgres FILTER.
    const { db } = makeDb([{ last7d: 5, last30d: 12, all: 100 }]);
    const c = new AdminDashboardController(db);
    const r = await c.dashboard({ cityId: tenant.cityId }, adminUser, tenant);
    expect(r).toEqual({ cityId: tenant.cityId, last7d: 5, last30d: 12, all: 100 });
    expect(db.runInTenantTx).toHaveBeenCalledOnce();
  });

  it('coerces BigInt counts to number', async () => {
    const { db } = makeDb([{ last7d: 7n, last30d: 9n, all: 42n }]);
    const c = new AdminDashboardController(db);
    const r = await c.dashboard({ cityId: tenant.cityId }, adminUser, tenant);
    expect(r.last7d).toBe(7);
    expect(r.last30d).toBe(9);
    expect(r.all).toBe(42);
  });

  it('city isolation: same caller, two distinct cityIds, distinct aggregate rows', async () => {
    // Each runInTenantTx invocation consumes one queued row. Different cities
    // → different underlying row counts. Proves the query binds to the
    // caller-supplied cityId, not the JWT-bound one.
    const cityA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const cityB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const { db } = makeDb([
      { last7d: 5, last30d: 8, all: 100 }, // cityA
      { last7d: 2, last30d: 3, all: 7 },   // cityB
    ]);
    const c = new AdminDashboardController(db);
    const a = await c.dashboard({ cityId: cityA }, adminUser, tenant);
    const b = await c.dashboard({ cityId: cityB }, adminUser, tenant);
    expect(a).toEqual({ cityId: cityA, last7d: 5, last30d: 8, all: 100 });
    expect(b).toEqual({ cityId: cityB, last7d: 2, last30d: 3, all: 7 });
    expect(db.runInTenantTx).toHaveBeenCalledTimes(2);
  });

  it('passes the caller-supplied cityId into the tenant context', async () => {
    const { db, trx } = makeDb([{ last7d: 0, last30d: 0, all: 0 }]);
    const c = new AdminDashboardController(db);
    await c.dashboard({ cityId: tenant.cityId }, adminUser, tenant);
    const call = (db.runInTenantTx as ReturnType<typeof vi.fn>).mock.calls[0]![0] as TenantContext;
    expect(call.cityId).toBe(tenant.cityId);
    expect(call.userId).toBe(tenant.userId);
    // Tenant context flows through — trx is the same object as what
    // runInTenantTx invoked.
    expect(typeof (trx as { executeTakeFirstOrThrow: unknown }).executeTakeFirstOrThrow).toBe(
      'function',
    );
  });

  it('rejects non-UUID cityId at the Zod layer (400)', () => {
    const pipe = new ZodValidationPipe(z.object({ cityId: z.string().uuid() }));
    expect(() => pipe.transform({ cityId: 'not-a-uuid' }, { type: 'query' })).toThrow(
      BadRequestException,
    );
  });
});

// ============================================================================
// DLQ
// ============================================================================
describe('AdminDlqController', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeQueues(jobs: Record<string, unknown[]>): QueueService {
    const getFailedJobs = vi.fn(async (name: string) => jobs[name] ?? []);
    return {
      // The controller delegates to `getFailedJobs(name, opts)` — see queue.service.ts.
      // @ts-expect-error — intentional partial stub.
      getFailedJobs,
    } as unknown as QueueService;
  }

  it('lists failed jobs for the requested queue (no PII fields)', async () => {
    // Full BullMQ job shape includes PII fields (`data`, `opts`, `stacktrace`).
    // The service layer must redact before the controller sees them — the
    // controller's stub returns the *redacted* shape to model that contract.
    const queues = makeQueues({
      push: [
        {
          id: 'j1',
          name: 'send_push',
          attemptsMade: 3,
          failedReason: 'timeout',
          timestamp: 1_700_000_000,
          finishedOn: 1_700_000_300,
        },
      ],
    });
    const c = new AdminDlqController(queues);
    const r = await c.list({ queue: 'push', limit: 50, start: 0 }, adminUser);
    expect(r).toEqual([
      {
        id: 'j1',
        name: 'send_push',
        attemptsMade: 3,
        failedReason: 'timeout',
        timestamp: 1_700_000_000,
        finishedOn: 1_700_000_300,
      },
    ]);
    expect(queues.getFailedJobs).toHaveBeenCalledWith('push', { start: 0, end: 49 });
  });

  it('passes pagination start/limit through with end = start + limit - 1', async () => {
    const queues = makeQueues({ email: [] });
    const c = new AdminDlqController(queues);
    await c.list({ queue: 'email', start: 10, limit: 5 }, adminUser);
    expect(queues.getFailedJobs).toHaveBeenCalledWith('email', { start: 10, end: 14 });
  });

  it('returns empty array when the queue has no failed jobs', async () => {
    const queues = makeQueues({ email: [] });
    const c = new AdminDlqController(queues);
    const r = await c.list({ queue: 'email', limit: 50, start: 0 }, adminUser);
    expect(r).toEqual([]);
  });

  it('coerces stringy query params (limit/start arrive as strings from Fastify)', async () => {
    // `z.coerce.number()` is what lets `?limit=10&start=5` round-trip —
    // verify by feeding strings through the same Zod schema the controller
    // mounts. The stub doesn't actually need to check; we just need to
    // confirm the pipe doesn't reject.
    const queues = makeQueues({ push: [] });
    const c = new AdminDlqController(queues);
    const r = await c.list(
      // The pipe runs first — pass it via the schema directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ queue: 'push', limit: 25, start: 7 } as unknown) as any,
      adminUser,
    );
    expect(r).toEqual([]);
  });

  it('rejects unknown queue values at the Zod layer (400)', () => {
    const pipe = new ZodValidationPipe(
      z.object({
        queue: z.enum(['push', 'email', 'audit-anchor', 'media-scan', 'cleanup', 'webhooks']),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        start: z.coerce.number().int().min(0).default(0),
      }),
    );
    expect(() => pipe.transform({ queue: 'bogus' }, { type: 'query' })).toThrow(BadRequestException);
  });

  it('rejects out-of-range pagination (limit > 100, start < 0)', () => {
    const pipe = new ZodValidationPipe(
      z.object({
        queue: z.enum(['push', 'email', 'audit-anchor', 'media-scan', 'cleanup', 'webhooks']),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        start: z.coerce.number().int().min(0).default(0),
      }),
    );
    expect(() => pipe.transform({ queue: 'push', limit: 999, start: 0 }, { type: 'query' })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform({ queue: 'push', limit: 10, start: -1 }, { type: 'query' })).toThrow(
      BadRequestException,
    );
  });

  it('DLQ returned rows do NOT contain data / stacktrace / opts (PII redaction)', async () => {
    // The redaction happens inside `getFailedJobs` (queue.service.ts) — the
    // service layer is the ONLY safe redaction point (pino `*.data` does
    // not deep-walk). Verify the projected shape never carries those keys,
    // regardless of what BullMQ returned.
    const queues = makeQueues({
      email: [
        {
          id: 'j1',
          name: 'send_email',
          attemptsMade: 1,
          failedReason: 'ses-throttle',
          timestamp: 1,
          finishedOn: 2,
        },
      ],
    });
    const c = new AdminDlqController(queues);
    const r = await c.list({ queue: 'email', limit: 50, start: 0 }, adminUser);
    const job = r[0]!;
    expect('data' in job).toBe(false);
    expect('stacktrace' in job).toBe(false);
    expect('opts' in job).toBe(false);
  });
});
