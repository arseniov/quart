import { firstValueFrom, isObservable, Observable, Subject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type {
  NotificationsSubscriber,
  NotificationSubscription,
} from '../../src/notifications/notifications-subscriber.service.js';
import { SseController } from '../../src/notifications/sse.controller.js';

const HEARTBEAT_MS = 25_000;

const user = (id: string): AuthUser => ({ id, cityId: '', isSuperAdmin: false, roleSnapshot: [] });

function makeSubscriber(
  opts: {
    events?: Observable<string>;
    cleanup?: () => Promise<void>;
    onSubscribe?: (userId: string) => void;
  } = {},
): NotificationsSubscriber & { capturedOnError?: (err: unknown) => void } {
  const mock: NotificationsSubscriber & { capturedOnError?: (err: unknown) => void } = {
    subscribe: vi.fn(
      (calledUserId: string, onError?: (err: unknown) => void): NotificationSubscription => {
        opts.onSubscribe?.(calledUserId);
        mock.capturedOnError = onError;
        return {
          events: opts.events ?? new Observable<string>(),
          cleanup: opts.cleanup ?? (async () => undefined),
        };
      },
    ),
  };
  return mock;
}

describe('SseController.stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an Observable (Nest @Sse contract)', () => {
    const sub = makeSubscriber();
    const ctrl = new SseController(sub);
    const obs = ctrl.stream(user('u-1'));
    expect(isObservable(obs)).toBe(true);
  });

  it('passes the current user id to the subscriber', () => {
    let captured: string | undefined;
    const sub = makeSubscriber({ onSubscribe: (u) => { captured = u; } });
    const ctrl = new SseController(sub);
    // subscribe (triggers the subscriber factory) then unsubscribe — take(0)
    // short-circuits and never reaches the source, so it can't be used here.
    const inner = ctrl.stream(user('user-42')).subscribe();
    expect(captured).toBe('user-42');
    inner.unsubscribe();
  });

  it('emits a typed MessageEvent per subscriber event', async () => {
    const subject = new Subject<string>();
    const sub = makeSubscriber({ events: subject.asObservable() });
    const ctrl = new SseController(sub);

    const out$ = ctrl.stream(user('u-1')).pipe(take(2), toArray());
    const done = firstValueFrom(out$);

    subject.next(JSON.stringify({ id: '1', event: 'notification.created', data: { title: 'hi' } }));
    subject.next(JSON.stringify({ id: '2', event: 'notification.updated', data: { unread: 3 } }));

    const out = await done;
    expect(out).toEqual([
      { id: '1', type: 'notification.created', data: { title: 'hi' } },
      { id: '2', type: 'notification.updated', data: { unread: 3 } },
    ]);
  });

  it('drops malformed subscriber messages without crashing', async () => {
    const subject = new Subject<string>();
    const sub = makeSubscriber({ events: subject.asObservable() });
    const ctrl = new SseController(sub);

    const out$ = ctrl.stream(user('u-1')).pipe(take(1), toArray());
    const done = firstValueFrom(out$);

    subject.next('not-json');
    subject.next(JSON.stringify({ id: '9', event: 'notification.created', data: { ok: 1 } }));

    const out = await done;
    expect(out).toEqual([
      { id: '9', type: 'notification.created', data: { ok: 1 } },
    ]);
  });

  it('emits a heartbeat MessageEvent every 25s and cleans up on disconnect', async () => {
    const cleanup = vi.fn(async () => undefined);
    const sub = makeSubscriber({
      events: new Observable<string>(), // never emits, never completes
      cleanup,
    });
    const ctrl = new SseController(sub);

    const collected: unknown[] = [];
    const inner = ctrl.stream(user('u-1')).subscribe((v) => collected.push(v));

    // First heartbeat at +25s.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 10);
    expect(collected).toEqual([{ type: 'heartbeat', data: {} }]);

    // Second heartbeat at +50s.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(collected).toEqual([
      { type: 'heartbeat', data: {} },
      { type: 'heartbeat', data: {} },
    ]);

    // Teardown clears the heartbeat AND closes the subscriber.
    inner.unsubscribe();
    expect(cleanup).toHaveBeenCalledTimes(1);

    // No more heartbeats after unsubscribe.
    const before = collected.length;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(collected.length).toBe(before);
  });

  it('forwards a mid-stream valkey error into the Observable error channel', async () => {
    const sub = makeSubscriber({ events: new Subject<string>().asObservable() });
    const ctrl = new SseController(sub);

    let received: unknown;
    const done = new Promise<void>((resolve) => {
      ctrl.stream(user('u-1')).subscribe({
        error: (err) => {
          received = err;
          resolve();
        },
      });
    });

    // The subscriber service would normally wire this through `sub.on('error', ...)`
    // from ioredis whenever a mid-stream Valkey disconnect fires.
    sub.capturedOnError?.(new Error('ECONNRESET'));

    await done;
    expect(received).toBeInstanceOf(Error);
    expect((received as Error).message).toBe('ECONNRESET');
  });
});
