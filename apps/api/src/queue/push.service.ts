import { Injectable, Logger } from '@nestjs/common';

import type { ConfigService } from '../config/config.service.js';
import type { DbService } from '../db/db.service.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo receipt statuses that mean "this token is permanently dead — drop the
 *  subscription, do NOT retry". Distinct from transient errors that should
 *  bubble up so BullMQ backs off and tries again.
 *  https://docs.expo.dev/push-notifications/sending-notifications/#response */
const TERMINAL_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
  'MessageTooBig',
  'MessageRateExceeded',
]);

export interface PushPayload {
  /** Expo push token (`ExponentPushToken[...]`). Redacted by pino (T37). */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Local push_subscription row id. Required so terminal errors can update
   *  the matching subscription; missing means we cannot drop it. */
  push_subscription_id?: string;
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: Record<string, unknown>;
}

interface ExpoResponse {
  data: ExpoReceipt[];
}

/** Deliver a push notification via Expo's HTTP API. Per-receipt terminal
 *  errors (`DeviceNotRegistered` / `InvalidCredentials` / `MessageTooBig` /
 *  `MessageRateExceeded`) mark the matching `push_subscriptions` row invalid
 *  and DROP — no retry. Anything else throws so BullMQ backs off and retries.
 *
 *  Job-payload callers (T38 fan-out) MUST set `jobId = ${notification_id}:${channel}`
 *  on the BullMQ `add()` so duplicate enqueues for the same notification+channel
 *  collapse to one delivery (see QueueService.enqueue). */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DbService,
    /** Injected for tests; defaults to the global `fetch` in production. */
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(p: PushPayload): Promise<void> {
    const r = await this.fetcher(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.env.EXPO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: p.to, title: p.title, body: p.body, data: p.data }),
      // Cap Expo RTT so a hung API doesn't pin BullMQ worker capacity.
      signal: AbortSignal.timeout(this.config.env.EXPO_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`expo push ${r.status}`);

    const body = (await r.json()) as ExpoResponse;
    await this.handleReceipts(p, body.data ?? []);
  }

  /** Apply per-receipt decisions. Pure so the worker can swap it in tests. */
  async handleReceipts(p: PushPayload, receipts: ExpoReceipt[]): Promise<void> {
    const invalidIds: string[] = [];
    const transient: ExpoReceipt[] = [];
    for (const r of receipts) {
      if (r.status === 'ok') continue;
      if (r.message && TERMINAL_ERROR_MESSAGES.has(r.message)) {
        if (p.push_subscription_id) invalidIds.push(p.push_subscription_id);
      } else {
        transient.push(r);
      }
    }

    if (invalidIds.length > 0) {
      // Single statement covers all terminal-error rows in one round trip.
      // ponytail: bulk-by-id is fine — receipts carry one token per send().
      await this.db.kysely
        .updateTable('push_subscriptions')
        .set({ status: 'invalid', invalidated_at: new Date() })
        .where('id', 'in', invalidIds)
        .execute();
    }

    if (transient.length > 0) {
      // Throw the first transient error so BullMQ logs it; the rest ride along
      // in the message so an operator can see all the receipts in one go.
      const first = transient[0]!;
      const tail = transient.length > 1 ? ` (+${transient.length - 1} more)` : '';
      throw new Error(`expo push transient error: ${first.message ?? 'unknown'}${tail}`);
    }
  }
}
