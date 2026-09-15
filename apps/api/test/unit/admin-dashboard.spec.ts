import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardController } from '../../src/admin/admin-dashboard.controller.js';
import { AdminDlqController } from '../../src/admin/admin-dlq.controller.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import type { QueueService } from '../../src/queue/queue.service.js';

// ----------------------------------------------------------------------------
// Trx stub — same shape as admin-endpoints.spec.ts: every terminal resolves to
// the next queued row in order. The dashboard runs one aggregate per row.
// ----------------------------------------------------------------------------
type Row = Record<string, unknown>;

function makeTrx(scenarios: Row[][]) {
  const queue: Row[][] = [...scenarios];
  const terminal = {
    execute: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return next;
    }),
    executeTakeFirst: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return next[0];
    }),
    executeTakeFirstOrThrow: vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.length === 0) throw new Error('trx stub: no row');
      return next[0];
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

function makeDb(scenarios: Row[][]) {
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

  it('returns KPI aggregates for 7d / 30d / all', async () => {
    // countSince fires twice (7d, 30d) plus the `all` aggregate = 3 queued rows.
    const { db } = makeDb([[{ c: 5 }], [{ c: 12 }], [{ c: 100 }]]);
    const c = new AdminDashboardController(db);
    const r = await c.dashboard({ cityId: tenant.cityId }, adminUser, tenant);
    expect(r.last7d).toBe(5);
    expect(r.last30d).toBe(12);
    expect(r.all).toBe(100);
    expect(db.runInTenantTx).toHaveBeenCalledOnce();
  });

  it('coerces BigInt count to number', async () => {
    const { db } = makeDb([[{ c: 7n }], [{ c: 9n }], [{ c: 42n }]]);
    const c = new AdminDashboardController(db);
    const r = await c.dashboard({ cityId: tenant.cityId }, adminUser, tenant);
    expect(r.last7d).toBe(7);
    expect(r.last30d).toBe(9);
    expect(r.all).toBe(42);
  });
});

// ============================================================================
// DLQ
// ============================================================================
describe('AdminDlqController', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeQueues(perQueue: Record<string, unknown[]>): QueueService {
    const getJobs = vi.fn(async (state: string) => {
      if (state !== 'failed') return [];
      return perQueue[Object.keys(perQueue)[0]!] ?? [];
    });
    return {
      // The controller reads `(queues as any).queues[name]` — see queue.service.ts.
      // @ts-expect-error — intentional partial stub for the private `queues` map.
      queues: {
        push: { getJobs },
        email: { getJobs },
        'audit-anchor': { getJobs },
        'media-scan': { getJobs },
        cleanup: { getJobs },
        webhooks: { getJobs },
      },
    } as unknown as QueueService;
  }

  it('lists failed jobs for the requested queue', async () => {
    const queues = makeQueues({ push: [{ id: 'j1', failedReason: 'timeout' }] });
    const c = new AdminDlqController(queues);
    const r = await c.list({ queue: 'push' }, adminUser);
    expect(r).toEqual([{ id: 'j1', failedReason: 'timeout' }]);
  });

  it('returns empty array when the queue has no failed jobs', async () => {
    const queues = makeQueues({ email: [] });
    const c = new AdminDlqController(queues);
    const r = await c.list({ queue: 'email' }, adminUser);
    expect(r).toEqual([]);
  });
});