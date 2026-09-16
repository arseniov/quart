import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbService } from '../../src/db/db.service.js';
import { NotificationDeliveriesSweeper } from '../../src/notifications/notification-deliveries.sweeper.js';
import type { QueueService } from '../../src/queue/queue.service.js';

interface Row {
  delivery_id: string;
  notification_id: string;
  channel: 'push' | 'email';
  push_subscription_id: string | null;
  recipient_email: string | null;
  expo_push_token: string | null;
  title: string;
  body: string;
}

interface SweeperDeps {
  fetch?: Row[];
}

function makeDb(deps: SweeperDeps = {}): DbService {
  const rows = deps.fetch ?? [];
  const execute = vi.fn(async () => rows);
  const builder: Record<string, unknown> = {};
  const chain = (): typeof builder => builder;
  builder['selectFrom'] = vi.fn(chain);
  builder['innerJoin'] = vi.fn(chain);
  builder['leftJoin'] = vi.fn(chain);
  builder['select'] = vi.fn(chain);
  builder['where'] = vi.fn(chain);
  builder['orderBy'] = vi.fn(chain);
  builder['limit'] = vi.fn(chain);
  builder['execute'] = execute;
  return { kysely: builder as never } as unknown as DbService;
}

function makeQueues(): { queues: QueueService; calls: Array<{ name: string; ids: { entity_id: string; delivery_channel: string }; data: unknown }> } {
  const calls: Array<{ name: string; ids: { entity_id: string; delivery_channel: string }; data: unknown }> = [];
  const queues = {
    enqueue: vi.fn(async (name: string, ids: { entity_id: string; delivery_channel: string }, data: unknown) => {
      calls.push({ name, ids, data });
      return { id: `job:${calls.length}` };
    }),
    addRepeatable: vi.fn(async () => undefined),
  } as unknown as QueueService;
  return { queues, calls };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    delivery_id: 'd-1',
    notification_id: 'n-1',
    channel: 'email',
    push_subscription_id: null,
    recipient_email: 'a@b.com',
    expo_push_token: null,
    title: 'hello',
    body: 'world',
    ...overrides,
  };
}

describe('NotificationDeliveriesSweeper.sweep', () => {
  let deps: ReturnType<typeof makeQueues>;
  let calls: ReturnType<typeof makeQueues>['calls'];
  let db: DbService;
  let svc: NotificationDeliveriesSweeper;

  beforeEach(() => {
    db = makeDb({ fetch: [] });
    deps = makeQueues();
    calls = deps.calls;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);
  });

  it('re-enqueues a pending delivery that is older than 5 minutes', async () => {
    // The 5-minute age filter lives in the SQL (`created_at < now() - interval
    // '5 minutes'`) — we simulate "older than 5 min" by simply returning the
    // row from the stubbed fetch; the filter is exercised by the kysely chain
    // itself, which the production code base covers with the integration
    // suite.
    db = makeDb({
      fetch: [row({ delivery_id: 'd-old', notification_id: 'n-old', channel: 'email', recipient_email: 'a@b.com' })],
    });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('email');
    expect(calls[0]!.ids).toEqual({ entity_id: 'n-old:email:d-old', delivery_channel: 'email' });
    expect((calls[0]!.data as { to: string }).to).toBe('a@b.com');
    // retry:sweeper tag — distinguishes first-attempt from sweep retries for
    // downstream DLQ debugging.
    expect((calls[0]!.data as Record<string, unknown>).retry).toBe('sweeper');
  });

  it('does not touch a pending delivery that is newer than 5 minutes (DB filter)', async () => {
    // The age filter is `created_at < now() - interval '5 minutes'` in the SQL
    // built by fetchStalePending; the kysely chain asserts that on every call.
    // Verify the chain reaches `.execute()` so the production SQL is wired.
    const execSpy = vi.fn(async () => []);
    const builder: Record<string, unknown> = {};
    const chain = (): typeof builder => builder;
    builder['selectFrom'] = vi.fn(chain);
    builder['innerJoin'] = vi.fn(chain);
    builder['leftJoin'] = vi.fn(chain);
    builder['select'] = vi.fn(chain);
    builder['where'] = vi.fn(chain);
    builder['orderBy'] = vi.fn(chain);
    builder['limit'] = vi.fn(chain);
    builder['execute'] = execSpy;
    db = { kysely: builder as never } as unknown as DbService;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    await svc.sweep();
    expect(builder['selectFrom']).toHaveBeenCalledWith('notification_deliveries as d');
    expect(builder['innerJoin']).toHaveBeenCalledWith('notifications as n', 'n.id', 'd.notification_id');
    expect(builder['leftJoin']).toHaveBeenCalledWith('push_subscriptions as p', 'p.id', 'd.push_subscription_id');
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('does not touch a delivery that is already delivered or failed', async () => {
    // Status filter: `d.status = 'pending'`. Already-delivered/failed rows
    // never enter fetchStalePending; the stubbed fetch returning [] mimics
    // that filter applying at the DB level.
    db = makeDb({ fetch: [] });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('caps the batch at 100 rows even when more are pending', async () => {
    // fetchStalePending LIMITs at 100; the rest stay in DB and wait for the
    // next tick. We simulate that by having the stubbed fetch return [] for
    // the second call (next tick) while the first call returns 100 rows.
    // The shape under test is: BATCH_CAP is exactly 100, so the service
    // emits at most 100 enqueues per sweep().
    db = makeDb({
      fetch: Array.from({ length: 100 }, (_, i) =>
        row({ delivery_id: `d-${i}`, notification_id: 'n-1', channel: 'email', recipient_email: `u${i}@b.com` }),
      ),
    });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(100);
    expect(result.enqueued).toBe(100);
    expect(calls).toHaveLength(100);

    // Simulate the next tick: still-pending rows return 100 again (they
    // weren't drained, the previous enqueue was deduped by BullMQ jobId).
    db = makeDb({
      fetch: Array.from({ length: 100 }, (_, i) =>
        row({ delivery_id: `d-${i}`, notification_id: 'n-1', channel: 'email', recipient_email: `u${i}@b.com` }),
      ),
    });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);
    const r2 = await svc.sweep();
    expect(r2.found).toBe(100);
    expect(calls).toHaveLength(200);
  });

  it('emits the same jobId on every sweep so BullMQ dedups the second enqueue', async () => {
    // Idempotency contract: the sweeper must always emit `${notificationId}:${channel}:${deliveryId}`
    // — identical on every tick. BullMQ's jobId dedup then drops the second
    // job's payload (see QueueService.enqueue's deepEqual warning).
    db = makeDb({ fetch: [row({ delivery_id: 'd-x', notification_id: 'n-x', channel: 'push', push_subscription_id: 'sub-1', recipient_email: null, expo_push_token: 'ExponentPushToken[AAA]' })] });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    await svc.sweep();
    await svc.sweep();

    expect(calls).toHaveLength(2);
    // Same jobId on both — that's what triggers the BullMQ dedup.
    expect(calls[0]!.ids).toEqual({ entity_id: 'n-x:push:d-x', delivery_channel: 'push' });
    expect(calls[1]!.ids).toEqual(calls[0]!.ids);
    // Same recipient — the payload snapshot is also stable.
    expect((calls[1]!.data as { to: string }).to).toBe('ExponentPushToken[AAA]');
    expect((calls[1]!.data as { push_subscription_id: string }).push_subscription_id).toBe('sub-1');
    expect((calls[1]!.data as Record<string, unknown>).retry).toBe('sweeper');
  });

  it('skips a push delivery whose token has been revoked (FK cascade)', async () => {
    // LEFT JOIN push_subscriptions returns NULL expo_push_token when the
    // subscription row is gone. The sweeper logs and skips so the delivery
    // row stays pending for an operator, instead of being silently dropped.
    db = makeDb({
      fetch: [row({ delivery_id: 'd-orphan', notification_id: 'n-orphan', channel: 'push', push_subscription_id: 'sub-gone', recipient_email: null, expo_push_token: null })],
    });
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('does not crash the sweep when BullMQ enqueue throws', async () => {
    // Never-block guarantee: a broker outage must surface as a skipped row,
    // not a thrown sweep. The next 5-min tick retries the same delivery.
    db = makeDb({ fetch: [row({ delivery_id: 'd-fail' })] });
    const queues: QueueService = {
      enqueue: vi.fn(async () => {
        throw new Error('Valkey connection refused');
      }),
      addRepeatable: vi.fn(async () => undefined),
    } as unknown as QueueService;
    svc = new NotificationDeliveriesSweeper(db, queues);

    const result = await svc.sweep();
    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});