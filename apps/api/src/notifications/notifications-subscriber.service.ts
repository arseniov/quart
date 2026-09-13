import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Observable } from 'rxjs';

/** Provider token for the Valkey URL — bound by SseModule to ConfigService.env.VALKEY_URL. */
export const VALKEY_URL = 'VALKEY_URL';

export interface NotificationChannelEvent {
  id: string;
  event: string;
  data: unknown;
}

export interface NotificationSubscription {
  /** Raw JSON payload as published to `notif:${userId}`. The controller parses
   *  it — keeping the wire format inside the subscriber. */
  events: Observable<string>;
  /** Tear down the subscription + Valkey connection. Idempotent; safe to call
   *  multiple times if the consumer unsubscribes more than once. */
  cleanup: () => Promise<void>;
}

/** Per-connection Valkey pub/sub for `notif:${userId}` channels. Each call to
 *  `subscribe()` opens a dedicated ioredis connection; the caller MUST release
 *  it via `cleanup()` when the SSE client disconnects. The dedicated connection
 *  matters because ioredis puts a connection in subscriber mode for the life
 *  of the socket — reusing the shared session-cache connection would block
 *  every other command on that socket until the SSE client goes away.
 *  ponytail: one ioredis connection per active SSE stream. Scale ceiling is
 *  bounded by concurrent SSE clients, not total API traffic. */
@Injectable()
export class NotificationsSubscriber {
  constructor(@Inject(VALKEY_URL) private readonly valkeyUrl: string) {}

  subscribe(userId: string, onError: (err: unknown) => void): NotificationSubscription {
    const sub = new Redis(this.valkeyUrl, { lazyConnect: false });
    // Forward mid-stream Valkey disconnects (ioredis 'error' event) to the
    // consumer. Without this the SSE stream hangs until client timeout —
    // ioredis retries forever and the Observable never sees a terminal event.
    sub.on('error', onError);
    const events$ = new Observable<string>((observer) => {
      const onMessage = (_ch: string, msg: string): void => observer.next(msg);
      sub.on('message', onMessage);
      sub.subscribe(`notif:${userId}`).catch((err: unknown) => observer.error(err));
      return () => {
        sub.off('message', onMessage);
      };
    });
    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      try {
        await sub.unsubscribe();
      } catch {
        // Already disconnected or never connected — best-effort teardown.
      }
      sub.disconnect();
    };
    return { events: events$, cleanup };
  }
}
