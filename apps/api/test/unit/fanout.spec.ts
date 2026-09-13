import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { FanoutService } from '../../src/notifications/fanout.service.js';
import type { QueueService } from '../../src/queue/queue.service.js';

// Recursive proxy: every chained kysely call returns a terminal builder with
// `execute` / `executeTakeFirstOrThrow`. Used by insert/select/update chains.
function terminal(value: unknown): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  b['returning'] = vi.fn(chain);
  b['returningAll'] = vi.fn(chain);
  b['values'] = vi.fn(chain);
  b['set'] = vi.fn(chain);
  b['where'] = vi.fn(chain);
  b['select'] = vi.fn(chain);
  b['selectAll'] = vi.fn(chain);
  b['orderBy'] = vi.fn(chain);
  b['execute'] = vi.fn(async () => value);
  b['executeTakeFirst'] = vi.fn(async () => value);
  b['executeTakeFirstOrThrow'] = vi.fn(async () => value);
  return b;
}

const tenant: TenantContext = {
  cityId: 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1',
  userId: 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  isSuperAdmin: false,
  requestId: 'req-1',
};

const USER_UUID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

function makeTrx(opts: {
  notificationId?: string;
  pushSubs?: Array<{ id: string; expo_push_token: string }>;
  email?: string | null;
} = {}) {
  const { notificationId = 'n-1', pushSubs = [], email = null } = opts;
  // Each selectFrom() call needs to return the right table's rows. We dispatch
  // by inspecting the table name so push_subscriptions returns subs and users
  // returns email — without this, both queries see the same terminal value.
  const tx: Record<string, unknown> = {
    insertInto: vi.fn(() => terminal({ id: notificationId })),
    selectFrom: vi.fn((table: string) => {
      if (table === 'push_subscriptions') return terminal(pushSubs);
      if (table === 'users') return terminal(email === null ? undefined : { email });
      return terminal([]);
    }),
    updateTable: vi.fn(() => terminal([])),
  };
  return tx;
}

function makeDb(trx: Record<string, unknown>): DbService {
  return {
    runInTenantTx: vi.fn(async (_ctx, fn) => fn(trx as never)),
  } as unknown as DbService;
}

function makeQueues(): { queues: QueueService; calls: Array<{ name: string; ids: { entity_id: string; delivery_channel: string }; data: unknown }> } {
  const calls: Array<{ name: string; ids: { entity_id: string; delivery_channel: string }; data: unknown }> = [];
  const queues = {
    enqueue: vi.fn(async (name: string, ids: { entity_id: string; delivery_channel: string }, data: unknown) => {
      calls.push({ name, ids, data });
      return { id: `job:${calls.length}` };
    }),
    addRepeatable: vi.fn(async () => undefined),
    onApplicationShutdown: vi.fn(async () => undefined),
  } as unknown as QueueService;
  return { queues, calls };
}

describe('FanoutService.fanout', () => {
  let trx: ReturnType<typeof makeTrx>;
  let db: DbService;
  let queues: QueueService;
  let calls: ReturnType<typeof makeQueues>['calls'];
  let svc: FanoutService;

  beforeEach(() => {
    trx = makeTrx({ notificationId: 'n-1', pushSubs: [], email: 'user@example.com' });
    db = makeDb(trx);
    const q = makeQueues();
    queues = q.queues;
    calls = q.calls;
    svc = new FanoutService(db, queues);
  });

  it('inserts one notification row and enqueues one email job when there are no push subs', async () => {
    await svc.fanout(
      { userId: USER_UUID, type: 'poll', title: 't', body: 'b', targetUrl: '/x', payload: {} },
      tenant,
    );

    // DB writes — one notification, one delivery (email).
    expect((trx.insertInto as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      'notifications',
      'notification_deliveries',
    ]);

    // One enqueue, on the email queue, with the real recipient + idempotent jobId.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('email');
    expect(calls[0]!.ids).toMatchObject({ delivery_channel: 'email' });
    expect(calls[0]!.ids.entity_id).toMatch(/^n-1:email:/);
    expect((calls[0]!.data as { to: string }).to).toBe('user@example.com');
  });

  it('enqueues one push job per active subscription with the expo token', async () => {
    trx = makeTrx({
      notificationId: 'n-2',
      pushSubs: [
        { id: 'sub-a', expo_push_token: 'ExponentPushToken[AAA]' },
        { id: 'sub-b', expo_push_token: 'ExponentPushToken[BBB]' },
      ],
      email: null,
    });
    db = makeDb(trx);
    const q = makeQueues();
    queues = q.queues;
    calls = q.calls;
    svc = new FanoutService(db, queues);

    await svc.fanout(
      { userId: USER_UUID, type: 'issue', title: 't', body: 'b', targetUrl: '/x', payload: {} },
      tenant,
    );

    // Two push enqueues (no email enqueue).
    const pushCalls = calls.filter((c) => c.name === 'push');
    expect(pushCalls).toHaveLength(2);
    const tokens = pushCalls.map((c) => (c.data as { to: string }).to).sort();
    expect(tokens).toEqual(['ExponentPushToken[AAA]', 'ExponentPushToken[BBB]']);
    // Every push job carries the subscription id so the worker can mark it invalid.
    expect(pushCalls.map((c) => (c.data as { push_subscription_id: string }).push_subscription_id).sort()).toEqual([
      'sub-a',
      'sub-b',
    ]);
    // Idempotent jobId = `${notificationId}:${channel}:${deliveryId}` — each
    // enqueue uses a unique entity_id from its delivery row so BullMQ dedups.
    expect(pushCalls.map((c) => c.ids.entity_id)).toEqual([
      expect.stringMatching(/^n-2:push:/) as unknown as string,
      expect.stringMatching(/^n-2:push:/) as unknown as string,
    ]);
    expect(pushCalls.every((c) => c.ids.delivery_channel === 'push')).toBe(true);
  });

  it('rejects absolute target_url pointing at an unallowed host', async () => {
    await expect(
      svc.fanout(
        { userId: USER_UUID, type: 'poll', title: 't', body: 'b', targetUrl: 'https://evil.example/x', payload: {} },
        tenant,
      ),
    ).rejects.toThrow(/target_url/);
  });

  it('accepts a same-host absolute target_url', async () => {
    await expect(
      svc.fanout(
        { userId: USER_UUID, type: 'poll', title: 't', body: 'b', targetUrl: 'https://quart.app/p/1', payload: {} },
        tenant,
      ),
    ).resolves.toBeUndefined();
  });

  it('skips enqueue when the user has neither active push subs nor an email', async () => {
    trx = makeTrx({ notificationId: 'n-3', pushSubs: [], email: null });
    db = makeDb(trx);
    const q = makeQueues();
    queues = q.queues;
    calls = q.calls;
    svc = new FanoutService(db, queues);

    await svc.fanout(
      { userId: USER_UUID, type: 'poll', title: 't', body: 'b', targetUrl: '/x', payload: {} },
      tenant,
    );

    // The notification row still lands (the inbox is the user-visible record);
    // only the enqueues are skipped.
    expect((trx.insertInto as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toContain('notifications');
    expect(calls).toHaveLength(0);
  });
});
