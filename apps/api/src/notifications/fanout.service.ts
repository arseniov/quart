import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import type { QueueService } from '../queue/queue.service.js';

/** Hosts the app is allowed to link to directly from a notification. Anything
 *  else gets rejected by `FanoutArgsSchema` so a crafted payload can't drive a
 *  user to an unknown external URL. Same-host absolute URLs (e.g. web push
 *  deep links) are accepted; everything else must be a relative `/path`.
 *  ponytail: hard-coded to two hosts. Add the CDN / marketing domain when
 *  those land. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['quart.app', 'www.quart.app']);

/** target_url must be either a same-origin relative path (`/...`) or an
 *  absolute URL pointing at an allow-listed host. */
const targetUrl = z
  .string()
  .refine((u) => {
    if (u.startsWith('/')) return true;
    try {
      const parsed = new URL(u);
      return ALLOWED_HOSTS.has(parsed.hostname);
    } catch {
      return false;
    }
  }, 'target_url must be a relative path or an allow-listed absolute URL');

export const FanoutArgsSchema = z.object({
  userId: z.string().uuid(),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  targetUrl: targetUrl.optional(),
  payload: z.record(z.unknown()).default({}),
});

export type FanoutArgs = z.infer<typeof FanoutArgsSchema>;

interface PushSubRow {
  id: string;
  expo_push_token: string;
}
interface UserRow {
  email: string | null;
}

interface PendingDelivery {
  channel: 'push' | 'email';
  deliveryId: string;
  // For push: expo token + subscription id. For email: recipient address.
  recipient: string;
  pushSubscriptionId?: string;
}

/** Per-channel fan-out. Writes the notification row + one
 *  `notification_deliveries` row per channel × subscription inside a single
 *  tenant transaction, then enqueues the BullMQ jobs OUTSIDE the tx so a
 *  broker outage cannot poison the DB write.
 *
 *  Idempotency: every jobId is `${notificationId}:${channel}:${deliveryId}`
 *  and BullMQ deduplicates by jobId, so retrying a fan-out is a no-op once
 *  the deliveries exist. If the enqueue step fails the delivery rows stay in
 *  `pending` and a sweeper can re-enqueue later by `deliveryId`. */
@Injectable()
export class FanoutService {
  private readonly logger = new Logger(FanoutService.name);

  constructor(
    private readonly db: DbService,
    private readonly queues: QueueService,
  ) {}

  async fanout(rawArgs: FanoutArgs, tenant: TenantContext): Promise<void> {
    const args = FanoutArgsSchema.parse(rawArgs);

    // Tx commits the notification row + every delivery row before any enqueue.
    // If the broker is down, the rows still land and the sweeper picks them up.
    const { notificationId, pending } = await this.db.runInTenantTx(tenant, async (trx) => {
      const n = await trx
        .insertInto('notifications')
        .values({
          recipient_user_id: args.userId,
          type: args.type,
          title: args.title,
          body: args.body,
          target_url: args.targetUrl ?? null,
          payload: args.payload as never,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      const notificationId = (n as { id: string }).id;

      const subs = await trx
        .selectFrom('push_subscriptions')
        .select(['id', 'expo_push_token'])
        .where('user_id', '=', args.userId as never)
        .where('status', '=', 'active' as never)
        .execute();

      const user = await trx
        .selectFrom('users')
        .select('email')
        .where('id', '=', args.userId as never)
        .executeTakeFirst();

      const out: PendingDelivery[] = [];
      for (const sub of subs as PushSubRow[]) {
        const delivery = await trx
          .insertInto('notification_deliveries')
          .values({
            notification_id: notificationId,
            channel: 'push',
            push_subscription_id: sub.id,
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow();
        out.push({
          channel: 'push',
          deliveryId: (delivery as { id: string }).id,
          recipient: sub.expo_push_token,
          pushSubscriptionId: sub.id,
        });
      }
      const email = (user as UserRow | undefined)?.email ?? null;
      if (email) {
        const delivery = await trx
          .insertInto('notification_deliveries')
          .values({
            notification_id: notificationId,
            channel: 'email',
            recipient_email: email,
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow();
        out.push({
          channel: 'email',
          deliveryId: (delivery as { id: string }).id,
          recipient: email,
        });
      }
      return { notificationId, pending: out };
    });

    if (pending.length === 0) return;

    // Best-effort enqueue outside the tx. A broker outage leaves the delivery
    // rows in `pending` for the sweeper.
    for (const d of pending) {
      try {
        if (d.channel === 'push') {
          await this.queues.enqueue(
            'push',
            { entity_id: `${notificationId}:push:${d.deliveryId}`, delivery_channel: 'push' },
            {
              to: d.recipient,
              title: args.title,
              body: args.body,
              data: { notificationId },
              push_subscription_id: d.pushSubscriptionId!,
            },
          );
        } else {
          await this.queues.enqueue(
            'email',
            { entity_id: `${notificationId}:email:${d.deliveryId}`, delivery_channel: 'email' },
            {
              to: d.recipient,
              subject: args.title,
              body: args.body,
              notificationId,
              deliveryId: d.deliveryId,
            },
          );
        }
      } catch (err) {
        // Don't rethrow — the row exists and the sweeper will retry. Log loudly.
        this.logger.error(
          `enqueue failed for delivery ${d.deliveryId} (${d.channel}); sweeper will retry`,
          err as Error,
        );
      }
    }
  }
}
