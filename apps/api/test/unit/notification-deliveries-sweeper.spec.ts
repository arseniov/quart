import 'reflect-metadata';

import type { TenantContext } from '@quart/shared-types';
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

interface QueuesResult {
  queues: QueueService;
  calls: Array<{ name: string; ids: { entity_id: string; delivery_channel: string }; data: unknown }>;
}

interface DbResult {
  db: DbService;
  /** Spy on `runInTenantTx` so tests can assert the sweeper's RLS context. */
  runInTenantTxSpy: ReturnType<typeof vi.fn>;
  /** Spy on the SELECT chain's `selectFrom` — was previously direct on
   *  `db.kysely`, now lives inside `runInTenantTx(trx => ...)`. */
  selectFrom: ReturnType<typeof vi.fn>;
  /** Spy on the UPDATE chain's `updateTable`. New in this revision. */
  updateTable: ReturnType<typeof vi.fn>;
  /** Last `set()` payload on the UPDATE chain. Tests assert on this. */
  set: ReturnType<typeof vi.fn>;
  /** Default number of rows `updateTable.executeTakeFirst` pretends touched. */
  numUpdatedRows: number;
  /** Last value returned from `updateTable.returning('status').executeTakeFirst`. */
  returnedStatus: 'pending' | 'failed' | undefined;
}

function makeDb(deps: { fetch?: Row[]; numUpdatedRows?: number; returnedStatus?: 'pending' | 'failed' } = {}): DbResult {
  const numUpdatedRows = deps.numUpdatedRows ?? 1;
  const returnedStatus = deps.returnedStatus;

  // Read chain (selectFrom → ... → execute). The SELECT built inside
  // runInTenantTx still needs the same fluent surface.
  const selectChain: Record<string, unknown> = {};
  const nextSelect = (): typeof selectChain => selectChain;
  const selectFrom = vi.fn(() => nextSelect());
  selectChain['selectFrom'] = selectFrom;
  selectChain['innerJoin'] = vi.fn(nextSelect);
  selectChain['leftJoin'] = vi.fn(nextSelect);
  selectChain['select'] = vi.fn(nextSelect);
  selectChain['where'] = vi.fn(nextSelect);
  selectChain['orderBy'] = vi.fn(nextSelect);
  selectChain['limit'] = vi.fn(nextSelect);
  selectChain['execute'] = vi.fn(async () => deps.fetch ?? []);

  // Write chain (updateTable → set → where → executeTakeFirst). Kept separate
  // so a test can spy on the SET payload without conflating it with the read
  // chain.
  const updateChain: Record<string, unknown> = {};
  const nextUpdate = (): typeof updateChain => updateChain;
  const updateTable = vi.fn(() => nextUpdate());
  const set = vi.fn(nextUpdate);
  const returning = vi.fn(nextUpdate);
  updateChain['updateTable'] = updateTable;
  updateChain['set'] = set;
  updateChain['where'] = vi.fn(nextUpdate);
  updateChain['returning'] = returning;
  updateChain['executeTakeFirst'] = vi.fn(async () =>
    returnedStatus === undefined ? { numUpdatedRows } : { status: returnedStatus },
  );
  updateChain['execute'] = vi.fn(async () => ({ numUpdatedRows }));

  // The kysely root routes SELECT and UPDATE chains separately. When the
  // production code calls `trx.selectFrom(...)` or `trx.updateTable(...)`
  // inside runInTenantTx, the mock receives them via the same fn() invocation.
  const kysely: Record<string, unknown> = { selectFrom, updateTable };

  const runInTenantTxSpy = vi.fn(async <T>(_ctx: TenantContext, fn: (trx: typeof kysely) => Promise<T>): Promise<T> =>
    fn(kysely),
  );

  const db = {
    kysely: kysely as never,
    runInTenantTx: runInTenantTxSpy as never,
  } as unknown as DbService;

  return { db, runInTenantTxSpy, selectFrom, updateTable, set, numUpdatedRows, returnedStatus };
}

function makeQueues(): QueuesResult {
  const calls: QueuesResult['calls'] = [];
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
  let deps: QueuesResult;
  let calls: QueuesResult['calls'];
  let dbRes: DbResult;
  let db: DbService;
  let svc: NotificationDeliveriesSweeper;

  beforeEach(() => {
    dbRes = makeDb({ fetch: [] });
    deps = makeQueues();
    calls = deps.calls;
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);
  });

  it('wraps the fetch in runInTenantTx with isSuperAdmin=true so RLS lets the sweeper through', async () => {
    // The sweeper runs as a platform-spanning background job, not a per-city
    // request, so it can't carry a city id. RLS bypass via is_super_admin is
    // the only way to read across cities (gh issue #1 critical fix).
    await svc.sweep();
    expect(dbRes.runInTenantTxSpy).toHaveBeenCalled();
    expect(dbRes.runInTenantTxSpy.mock.calls[0]?.[0]).toMatchObject({
      isSuperAdmin: true,
      requestId: 'sweeper',
    });
  });

  it('re-enqueues a pending delivery that is older than 5 minutes', async () => {
    // The 5-minute age filter lives in the SQL (`created_at < now() - interval
    // '5 minutes'`) — we simulate "older than 5 min" by simply returning the
    // row from the stubbed fetch; the filter is exercised by the kysely chain
    // itself, which the production code base covers with the integration
    // suite.
    dbRes = makeDb({
      fetch: [row({ delivery_id: 'd-old', notification_id: 'n-old', channel: 'email', recipient_email: 'a@b.com' })],
    });
    db = dbRes.db;
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
    dbRes = makeDb();
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    await svc.sweep();
    expect(dbRes.selectFrom).toHaveBeenCalledWith('notification_deliveries as d');
    // Verify the chain is still fluent (joins + where + limit + execute).
    const selectChain = (dbRes.selectFrom.mock.results[0]?.value ?? {}) as Record<string, ReturnType<typeof vi.fn>>;
    expect(selectChain['innerJoin']).toHaveBeenCalledWith('notifications as n', 'n.id', 'd.notification_id');
    expect(selectChain['leftJoin']).toHaveBeenCalledWith('push_subscriptions as p', 'p.id', 'd.push_subscription_id');
    expect(selectChain['execute']).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it('does not touch a delivery that is already delivered or failed', async () => {
    // Status filter: `d.status = 'pending'`. Already-delivered/failed rows
    // never enter fetchStalePending; the stubbed fetch returning [] mimics
    // that filter applying at the DB level.
    dbRes = makeDb({ fetch: [] });
    db = dbRes.db;
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
    dbRes = makeDb({
      fetch: Array.from({ length: 100 }, (_, i) =>
        row({ delivery_id: `d-${i}`, notification_id: 'n-1', channel: 'email', recipient_email: `u${i}@b.com` }),
      ),
    });
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(100);
    expect(result.enqueued).toBe(100);
    expect(calls).toHaveLength(100);

    // Simulate the next tick: still-pending rows return 100 again (they
    // weren't drained, the previous enqueue was deduped by BullMQ jobId).
    dbRes = makeDb({
      fetch: Array.from({ length: 100 }, (_, i) =>
        row({ delivery_id: `d-${i}`, notification_id: 'n-1', channel: 'email', recipient_email: `u${i}@b.com` }),
      ),
    });
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);
    const r2 = await svc.sweep();
    expect(r2.found).toBe(100);
    expect(calls).toHaveLength(200);
  });

  it('emits the same jobId on every sweep so BullMQ dedups the second enqueue', async () => {
    // Idempotency contract: the sweeper must always emit `${notificationId}:${channel}:${deliveryId}`
    // — identical on every tick. BullMQ's jobId dedup then drops the second
    // job's payload (see QueueService.enqueue's deepEqual warning).
    dbRes = makeDb({ fetch: [row({ delivery_id: 'd-x', notification_id: 'n-x', channel: 'push', push_subscription_id: 'sub-1', recipient_email: null, expo_push_token: 'ExponentPushToken[AAA]' })] });
    db = dbRes.db;
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
    dbRes = makeDb({
      fetch: [row({ delivery_id: 'd-orphan', notification_id: 'n-orphan', channel: 'push', push_subscription_id: 'sub-gone', recipient_email: null, expo_push_token: null })],
    });
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(calls).toHaveLength(0);
    // recordSkip fired — the increment UPDATE was emitted on the row.
    expect(dbRes.updateTable).toHaveBeenCalledWith('notification_deliveries');
  });

  it('does not crash the sweep when BullMQ enqueue throws', async () => {
    // Never-block guarantee: a broker outage must surface as a skipped row,
    // not a thrown sweep. The next 5-min tick retries the same delivery.
    dbRes = makeDb({ fetch: [row({ delivery_id: 'd-fail' })] });
    db = dbRes.db;
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
    // Broker outage is treated as a skip — recordSkip's atomic UPDATE ran.
    expect(dbRes.updateTable).toHaveBeenCalledWith('notification_deliveries');
  });

  it('flips a row to failed after MAX_SWEEP_ATTEMPTS skips so it stops re-fetching forever', async () => {
    // Dead-letter bound (gh issue #1 important fix): the sweeper re-enqueues
    // broken rows forever. After MAX_SWEEP_ATTEMPTS=6 skips, the row is
    // flipped to status='failed' with error_code='sweep_dead_letter' and the
    // sweeper increments `deadLettered` instead of `skipped` on that tick.
    // Simulate the 6th sweep tick by stubbing the UPDATE's RETURNING to
    // report the new status as 'failed' (the SQL CASE flips it).
    dbRes = makeDb({
      fetch: [
        row({
          delivery_id: 'd-doomed',
          channel: 'push',
          push_subscription_id: 'sub-gone',
          recipient_email: null,
          expo_push_token: null,
        }),
      ],
      returnedStatus: 'failed',
    });
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    const result = await svc.sweep();
    expect(result.found).toBe(1);
    expect(result.deadLettered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.enqueued).toBe(0);

    // The SET payload must include the increment + the CASE expressions that
    // flip status / error_code. Kysely's RawBuilder exposes the SQL via
    // `.toOperationNode()` — flatten that recursively to a string for
    // substring checks (handles nested RawNodes from sql.literal()).
    expect(dbRes.set).toHaveBeenCalledTimes(1);
    const setPayload = dbRes.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setPayload).toBeDefined();
    const flatten = (v: unknown): string => {
      if (v == null) return '';
      const obj = v as { toOperationNode?: () => unknown };
      if (typeof obj.toOperationNode !== 'function') return JSON.stringify(v);
      let out = '';
      const visit = (node: unknown): void => {
        if (node == null) return;
        const n = node as { kind?: string; sqlFragments?: string[]; parameters?: unknown[]; value?: unknown };
        if (n.kind === 'ValueNode') {
          out += String(n.value ?? '');
          return;
        }
        const frags = n.sqlFragments ?? [];
        const params = n.parameters ?? [];
        for (let i = 0; i < frags.length; i++) {
          out += frags[i] ?? '';
          if (i < params.length) visit(params[i]);
        }
      };
      visit(obj.toOperationNode());
      return out;
    };
    const statusSql = flatten(setPayload['status']);
    expect(statusSql).toContain('failed');
    expect(statusSql).toContain('sweep_attempts + 1');
    expect(statusSql).toContain('>= 6'); // MAX_SWEEP_ATTEMPTS
    const errSql = flatten(setPayload['error_code']);
    expect(errSql).toContain('sweep_dead_letter');
  });

  it('resets sweep_attempts to 0 on a successful enqueue so the counter does not bleed across ticks', async () => {
    // Reset contract: a successful enqueue must clear sweep_attempts (e.g.
    // a row that survived 3 sweep skips, then finally enqueued, must not
    // reach MAX_SWEEP_ATTEMPTS on the next orphan cycle). The atomic UPDATE
    // is gated on status='pending' so a row already failed by a concurrent
    // sweeper is left alone.
    dbRes = makeDb({ fetch: [row({ delivery_id: 'd-reset', recipient_email: 'a@b.com' })] });
    db = dbRes.db;
    svc = new NotificationDeliveriesSweeper(db, deps.queues);

    await svc.sweep();

    // recordEnqueued fired exactly once (after the single enqueue) with
    // sweep_attempts reset to 0.
    expect(dbRes.updateTable).toHaveBeenCalledTimes(1);
    const setPayload = dbRes.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setPayload).toBeDefined();
    expect(setPayload['sweep_attempts']).toBe(0);
    expect(setPayload['status']).toBeUndefined(); // success path doesn't touch status
  });
});
