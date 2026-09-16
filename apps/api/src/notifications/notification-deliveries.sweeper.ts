import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantContext } from '@quart/shared-types';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor — see queue.module.ts for precedent.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueService } from '../queue/queue.service.js';

/** BullMQ job-name on the `cleanup` queue that triggers a sweep. Stable so
 *  the repeatable registration is dedup-safe across module restarts. */
export const NOTIFICATION_DELIVERIES_SWEEP_JOB = 'notification-deliveries-sweep';

/** Hard cap per tick — leaves the rest for the next 5-min slot so a backlog
 *  can't monopolise the worker. */
const BATCH_CAP = 100;

/** Rows older than this are eligible to re-enqueue. Equal to the BullMQ push
 *  retry envelope (~155s for 5 attempts × exponential 5s base) so we don't
 *  race a worker that's still draining the original job. */
const STALE_AFTER_MINUTES = 5;

/** Max times a row can be skipped before it's flipped to 'failed'. Self-DoS
 *  guard — without this, a delivery whose FK target vanished (e.g. push
 *  subscription revoked) keeps the sweeper busy on every tick forever. T57
 *  already exposes failed rows in the DLQ viewer. */
const MAX_SWEEP_ATTEMPTS = 6;

/** Synthetic super-admin tenant context. RLS requires either `app.city_id`
 *  matching or `app.is_super_admin = 'true'`; the sweeper is platform-spanning
 *  so it uses the bypass. `cityId: ''` is fine — the policy's OR short-
 *  circuits on `is_super_admin`. */
const SWEEPER_TENANT_CTX: TenantContext = {
  cityId: '',
  userId: '',
  isSuperAdmin: true,
  requestId: 'sweeper',
};

interface PendingRow {
  delivery_id: string;
  notification_id: string;
  channel: 'push' | 'email';
  push_subscription_id: string | null;
  recipient_email: string | null;
  expo_push_token: string | null;
  title: string;
  body: string;
}

type SweepOutcome = 'enqueued' | 'skipped' | 'dead-letter';

/** Background sweeper for `notification_deliveries` rows that fan-out
 *  (T38, fanout.service.ts) couldn't enqueue — typically because Valkey or
 *  BullMQ was unavailable when the original enqueue happened. The jobId is
 *  stable (`${notificationId}:${channel}:${deliveryId}`) so re-enqueueing is
 *  a BullMQ-side dedup, not a double-delivery.
 *
 *  ponytail: the sweep runs as a single-process loop on the `cleanup` queue;
 *  multi-replica deployments will compete for the same jobId and BullMQ will
 *  serialize. Promote to per-shard cron if throughput needs it. The dead-
 *  letter UPDATE is atomic against `status='pending'` so multi-replica races
 *  are also safe at the row level — no SELECT FOR UPDATE needed yet. */
@Injectable()
export class NotificationDeliveriesSweeper {
  private readonly logger = new Logger(NotificationDeliveriesSweeper.name);

  constructor(
    private readonly db: DbService,
    private readonly queues: QueueService,
  ) {}

  /** Find pending deliveries older than 5 min and re-enqueue them. Returns
   *  counters so tests + logs can assert the cap kicked in. */
  async sweep(): Promise<{ found: number; enqueued: number; skipped: number; deadLettered: number }> {
    const rows = await this.fetchStalePending();
    if (rows.length === 0) return { found: 0, enqueued: 0, skipped: 0, deadLettered: 0 };

    let enqueued = 0;
    let skipped = 0;
    let deadLettered = 0;
    for (const row of rows) {
      const outcome = await this.requeue(row);
      if (outcome === 'enqueued') enqueued++;
      else if (outcome === 'skipped') skipped++;
      else deadLettered++;
    }
    if (enqueued > 0 || skipped > 0 || deadLettered > 0) {
      this.logger.log(
        `sweep: found=${rows.length} enqueued=${enqueued} skipped=${skipped} deadLettered=${deadLettered}`,
      );
    }
    return { found: rows.length, enqueued, skipped, deadLettered };
  }

  private async fetchStalePending(): Promise<PendingRow[]> {
    // LEFT JOIN push_subscriptions so a missing subscription doesn't drop the
    // delivery row — the re-enqueue step will skip it with a logged warning
    // and the row stays pending for the next tick (operator action).
    return this.db.runInTenantTx(SWEEPER_TENANT_CTX, async (trx) => {
      const rows = await trx
        .selectFrom('notification_deliveries as d')
        .innerJoin('notifications as n', 'n.id', 'd.notification_id')
        .leftJoin('push_subscriptions as p', 'p.id', 'd.push_subscription_id')
        .select([
          'd.id as delivery_id',
          'd.channel',
          'd.push_subscription_id',
          'd.recipient_email',
          'p.expo_push_token',
          'n.id as notification_id',
          'n.title',
          'n.body',
        ])
        .where('d.status', '=', 'pending')
        .where('d.created_at', '<', sql<Date>`now() - interval '${sql.literal(STALE_AFTER_MINUTES)} minutes'`)
        .orderBy('d.created_at', 'asc')
        .limit(BATCH_CAP)
        .execute();
      return rows as PendingRow[];
    });
  }

  private async requeue(row: PendingRow): Promise<SweepOutcome> {
    const queueName = row.channel === 'push' ? 'push' : 'email';
    const entityId = `${row.notification_id}:${row.channel}:${row.delivery_id}`;
    // Tag `retry: 'sweeper'` so downstream handlers / DLQ debugging can tell
    // first-attempt from sweep retries. BullMQ's jobId dedup will drop the
    // marker if a prior enqueue is still pending — that's harmless.
    const data =
      row.channel === 'push'
        ? {
            to: row.expo_push_token,
            title: row.title,
            body: row.body,
            data: { notificationId: row.notification_id },
            push_subscription_id: row.push_subscription_id,
            retry: 'sweeper',
          }
        : {
            to: row.recipient_email,
            subject: row.title,
            body: row.body,
            notificationId: row.notification_id,
            deliveryId: row.delivery_id,
            retry: 'sweeper',
          };

    if (row.channel === 'push' && !row.expo_push_token) {
      // Subscription vanished (token revoked, FK cascade) — record the skip;
      // after MAX_SWEEP_ATTEMPTS the row flips to 'failed' so it doesn't
      // stay in the hot path forever.
      this.logger.warn(`sweep: delivery ${row.delivery_id} has no push subscription; skipping`);
      return this.recordSkip(row.delivery_id);
    }
    if (row.channel === 'email' && !row.recipient_email) {
      this.logger.warn(`sweep: delivery ${row.delivery_id} has no recipient_email; skipping`);
      return this.recordSkip(row.delivery_id);
    }

    try {
      await this.queues.enqueue(queueName, { entity_id: entityId, delivery_channel: row.channel }, data);
      return await this.recordEnqueued(row.delivery_id);
    } catch (err) {
      // Never block — log + count as skip so the next tick can retry. The
      // pending row is the audit trail that this delivery never landed.
      this.logger.error(`sweep: enqueue failed for delivery ${row.delivery_id} (${row.channel})`, err as Error);
      return this.recordSkip(row.delivery_id);
    }
  }

  /** Successful enqueue → reset the counter. Atomic against `status='pending'`
   *  so a row that flipped to `failed` between fetch and update is left alone. */
  private async recordEnqueued(deliveryId: string): Promise<SweepOutcome> {
    await this.db.runInTenantTx(SWEEPER_TENANT_CTX, async (trx) => {
      await trx
        .updateTable('notification_deliveries')
        .set({
          sweep_attempts: 0,
          last_swept_at: sql<Date>`now()`,
        })
        .where('id', '=', deliveryId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
    });
    return 'enqueued';
  }

  /** Skip (no recipient, FK gone, or enqueue threw) → atomic increment + flip
   *  to `failed` once the cap is reached. Single UPDATE so the increment and
   *  the status transition can't race against a concurrent sweeper. */
  private async recordSkip(deliveryId: string): Promise<SweepOutcome> {
    return this.db.runInTenantTx(SWEEPER_TENANT_CTX, async (trx) => {
      const updated = await trx
        .updateTable('notification_deliveries')
        .set({
          sweep_attempts: sql`notification_deliveries.sweep_attempts + 1`,
          last_swept_at: sql<Date>`now()`,
          status: sql<'pending' | 'failed'>`CASE WHEN notification_deliveries.sweep_attempts + 1 >= ${MAX_SWEEP_ATTEMPTS} THEN 'failed'::text ELSE 'pending'::text END`,
          error_code: sql<string | null>`CASE WHEN notification_deliveries.sweep_attempts + 1 >= ${MAX_SWEEP_ATTEMPTS} THEN ${sql.literal('sweep_dead_letter')} ELSE notification_deliveries.error_code END`,
        })
        .where('id', '=', deliveryId)
        .where('status', '=', 'pending')
        .returning('status')
        .executeTakeFirst();
      return updated?.status === 'failed' ? 'dead-letter' : 'skipped';
    });
  }
}
