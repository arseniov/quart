import { Controller, type MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationsSubscriber } from './notifications-subscriber.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

const HEARTBEAT_MS = 25_000;

/** `GET /me/notifications/stream` — Server-Sent Events feed of
 *  `notif:${userId}` Valkey pub/sub messages, framed as typed
 *  `{ id, type, data }` MessageEvents.
 *
 *  Heartbeat: a typed MessageEvent with `type: 'heartbeat'` and `data: {}`
 *  every 25s. We deliberately emit it AS an event (not an SSE comment line)
 *  so the whole stream goes through the `Observable` contract — the
 *  alternative (raw `reply.raw.write(':heartbeat\n\n')`) bypasses Nest's
 *  `@Sse()` serialization and would couple the controller to the HTTP
 *  transport. Clients filter by `type === 'heartbeat'` and ignore.
 *  ponytail: 25s ceiling — kept under the 30s proxy-idle-timeout (nginx
 *  default `proxy_read_timeout` / envoy `idle_timeout`) so intermediate
 *  proxies never close an idle SSE connection before we keep it alive. */
@Controller('me/notifications')
@ApiTags('notifications-sse')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
export class SseController {
  constructor(private readonly subscriber: NotificationsSubscriber) {}

  @Sse('stream')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const userId = user.id;
    return new Observable<MessageEvent>((observer) => {
      // onError forwards mid-stream Valkey disconnects (ioredis 'error' event)
      // straight into the Observable's error channel — Nest then closes the
      // SSE response. Without this the stream hangs until client timeout.
      const { events, cleanup } = this.subscriber.subscribe(userId, (err) =>
        observer.error(err as Error),
      );
      const inner = events.subscribe({
        next: (raw) => {
          try {
            const evt = JSON.parse(raw) as { id: string; event: string; data: unknown };
            // Nest's MessageEvent.data is `string | object`; we publish parsed
            // JSON objects so the cast is safe. If a publisher ever ships a
            // primitive in `data` we'd surface it as `[object]` to the client.
            observer.next({ id: evt.id, type: evt.event, data: evt.data as object });
          } catch {
            // Drop malformed payloads — the SSE channel carries typed events;
            // unparseable bytes are an upstream bug, not a client error.
          }
        },
        error: (err) => observer.error(err),
      });
      const hb = setInterval(() => observer.next({ type: 'heartbeat', data: {} }), HEARTBEAT_MS);
      return () => {
        clearInterval(hb);
        inner.unsubscribe();
        // cleanup is async; we fire-and-forget because RxJS teardown is sync.
        // The Valkey connection has `disconnect()` (sync) at its tail, so the
        // socket actually closes inside the cleanup body even if the awaited
        // unsubscribe rejects — the catch above swallows it.
        void cleanup();
      };
    });
  }
}
