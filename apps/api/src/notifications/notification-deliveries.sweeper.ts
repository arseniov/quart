import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';

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

/** Background sweeper for `notification_deliveries` rows that fan-out
 *  (T38, fanout.service.ts) couldn't enqueue — typically because Valkey or
 *  BullMQ was unavailable when the original enqueue happened. The jobId is
 *  stable (`${notificationId}:${channel}:${deliveryId}`) so re-enqueueing is
 *  a BullMQ-side dedup, not a double-delivery.
 *
 *  ponytail: the sweep runs as a single-process loop on the `cleanup` queue;
 *  multi-replica deployments will compete for the same jobId and BullMQ will
 *  serialize. Promote to per-shard cron if throughput needs it. */
@Injectable()
export class NotificationDeliveriesSweeper {
  private readonly logger = new Logger(NotificationDeliveriesSweeper.name);

  constructor(
    private readonly db: DbService,
    private readonly queues: QueueService,
  ) {}

  /** Find pending deliveries older than 5 min and re-enqueue them. Returns
   *  counters so tests + logs can assert the cap kicked in. */
  async sweep(): Promise<{ found: number; enqueued: number; skipped: number }> {
    const rows = await this.fetchStalePending();
    if (rows.length === 0) return { found: 0, enqueued: 0, skipped: 0 };

    let enqueued = 0;
    let skipped = 0;
    for (const row of rows) {
      if (await this.requeue(row)) enqueued++;
      else skipped++;
    }
    if (enqueued > 0 || skipped > 0) {
      this.logger.log(`sweep: found=${rows.length} enqueued=${enqueued} skipped=${skipped}`);
    }
    return { found: rows.length, enqueued, skipped };
  }

  private async fetchStalePending(): Promise<PendingRow[]> {
    // LEFT JOIN push_subscriptions so a missing subscription doesn't drop the
    // delivery row — the re-enqueue step will skip it with a logged warning
    // and the row stays pending for the next tick (operator action).
    return (await this.db.kysely
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
      .execute()) as PendingRow[];
  }

  private async requeue(row: PendingRow): Promise<boolean> {
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
      // Subscription vanished (token revoked, FK cascade) — leave the row
      // pending so an operator can see it instead of silently dropping the
      // delivery.
      this.logger.warn(`sweep: delivery ${row.delivery_id} has no push subscription; skipping`);
      return false;
    }
    if (row.channel === 'email' && !row.recipient_email) {
      this.logger.warn(`sweep: delivery ${row.delivery_id} has no recipient_email; skipping`);
      return false;
    }

    try {
      await this.queues.enqueue(queueName, { entity_id: entityId, delivery_channel: row.channel }, data);
      return true;
    } catch (err) {
      // Never block — log + return false so the next tick can retry. The
      // pending row is the audit trail that this delivery never landed.
      this.logger.error(`sweep: enqueue failed for delivery ${row.delivery_id} (${row.channel})`, err as Error);
      return false;
    }
  }
}