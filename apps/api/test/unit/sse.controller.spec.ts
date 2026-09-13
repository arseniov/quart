import { firstValueFrom, isObservable, Observable, Subject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NotificationsSubscriber,
  NotificationSubscription,
} from '../../src/notifications/notifications-subscriber.service.js';
import { SseController } from '../../src/notifications/sse.controller.js';

const HEARTBEAT_MS = 30_000;

function makeSubscriber(
  opts: {
    events?: Observable<string>;
    cleanup?: () => Promise<void>;
    onSubscribe?: (userId: string) => void;
  } = {},
): NotificationsSubscriber {
  const subscribe = vi.fn((userId: string): NotificationSubscription => {
    opts.onSubscribe?.(userId);
    return {
      events: opts.events ?? new Observable<string>(),
      cleanup: opts.cleanup ?? (async () => undefined),
    };
  });
  return { subscribe } as unknown as NotificationsSubscriber;
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
    const obs = ctrl.stream({ id: 'u-1' } as never);
    expect(isObservable(obs)).toBe(true);
  });

  it('passes the current user id to the subscriber', () => {
    let captured: string | undefined;
    const sub = makeSubscriber({ onSubscribe: (u) => { captured = u; } });
    const ctrl = new SseController(sub);
    // take(0) subscribes (which triggers the subscriber factory) then
    // immediately completes without consuming the underlying Observable.
    void ctrl.stream({ id: 'user-42' } as never).pipe(take(0)).subscribe();
    expect(captured).toBe('user-42');
  });

  it('emits a typed MessageEvent per subscriber event', async () => {
    const subject = new Subject<string>();
    const sub = makeSubscriber({ events: subject.asObservable() });
    const ctrl = new SseController(sub);

    const out$ = ctrl.stream({ id: 'u-1' } as never).pipe(take(2), toArray());
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

    const out$ = ctrl.stream({ id: 'u-1' } as never).pipe(take(1), toArray());
    const done = firstValueFrom(out$);

    subject.next('not-json');
    subject.next(JSON.stringify({ id: '9', event: 'notification.created', data: { ok: 1 } }));

    const out = await done;
    expect(out).toEqual([
      { id: '9', type: 'notification.created', data: { ok: 1 } },
    ]);
  });

  it('emits a heartbeat MessageEvent every 30s and cleans up on disconnect', async () => {
    const cleanup = vi.fn(async () => undefined);
    const sub = makeSubscriber({
      events: new Observable<string>(), // never emits, never completes
      cleanup,
    });
    const ctrl = new SseController(sub);

    const collected: unknown[] = [];
    const inner = ctrl.stream({ id: 'u-1' } as never).subscribe((v) => collected.push(v));

    // First heartbeat at +30s.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS + 10);
    expect(collected).toEqual([{ type: 'heartbeat', data: {} }]);

    // Second heartbeat at +60s.
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
});
