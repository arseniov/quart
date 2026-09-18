// src/lib/__tests__/offline-queue.test.ts
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => {
      // ponytail: deterministic monotonic UUIDs — jest-expo doesn't auto-mock expo-crypto,
      //          and we need distinct ids per call to verify id-based queue operations.
      counter += 1;
      const hex = counter.toString(16).padStart(12, '0');
      return `11111111-1111-4111-8111-${hex}`;
    }),
  };
});

jest.mock('@/lib/storage', () => {
  const store = new Map<string, string>();
  const mmkv = {
    getString: (k: string) => store.get(k) ?? undefined,
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
    clearAll: () => store.clear(),
  };
  return {
    mmkv,
    mmkvStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});

jest.mock('@/api/client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    del: jest.fn(),
  },
}));

import { mmkv } from '@/lib/storage';
import { apiClient } from '@/api/client';
import { enqueue, loadDlq, loadQueue, removeFromQueue, flushQueue } from '../offline-queue';

const mApi = apiClient as jest.Mocked<typeof apiClient>;
const mMmkv = mmkv as unknown as { clearAll: () => void };

beforeEach(() => {
  mMmkv.clearAll();
  jest.clearAllMocks();
});

describe('enqueue + loadQueue', () => {
  it('persists a create_issue action with id, attempts=0, queued_at set', () => {
    const a = enqueue({
      kind: 'create_issue',
      payload: { category_id: 'c1', description: 'd' },
      photos: ['file:///x.jpg'],
    });

    expect(a.kind).toBe('create_issue');
    expect(a.id).toBe('11111111-1111-4111-8111-000000000001');
    expect(a.attempts).toBe(0);
    expect(typeof a.queued_at).toBe('string');
    expect(new Date(a.queued_at).toString()).not.toBe('Invalid Date');

    const list = loadQueue();
    expect(list).toHaveLength(1);
    expect(list[0]!).toEqual(a);
  });

  it('persists a mark_notification_read action', () => {
    const a = enqueue({ kind: 'mark_notification_read', notificationId: 'n-42' });
    expect(a.kind).toBe('mark_notification_read');
    expect(a.notificationId).toBe('n-42');
    expect(loadQueue()).toHaveLength(1);
  });

  it('appends multiple entries', () => {
    enqueue({ kind: 'create_issue', payload: { a: 1 }, photos: [] });
    enqueue({ kind: 'mark_notification_read', notificationId: 'n-1' });
    expect(loadQueue()).toHaveLength(2);
  });
});

describe('removeFromQueue', () => {
  it('removes only the matching id', () => {
    const a = enqueue({ kind: 'create_issue', payload: {}, photos: [] });
    enqueue({ kind: 'create_issue', payload: {}, photos: [] });
    removeFromQueue(a.id);
    const remaining = loadQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).not.toBe(a.id);
  });

  it('no-op when id is unknown', () => {
    enqueue({ kind: 'create_issue', payload: {}, photos: [] });
    removeFromQueue('00000000-0000-0000-0000-000000000000');
    expect(loadQueue()).toHaveLength(1);
  });
});

describe('flushQueue', () => {
  it('calls apiClient.post for create_issue and removes on success', async () => {
    enqueue({ kind: 'create_issue', payload: { category_id: 'c' }, photos: [] });
    mApi.post.mockResolvedValueOnce({} as never);

    const r = await flushQueue();

    expect(mApi.post).toHaveBeenCalledWith('/issues', { category_id: 'c' });
    expect(loadQueue()).toHaveLength(0);
    expect(r).toEqual({ ok: 1, failed: 0 });
  });

  it('calls /notifications/:id/read for mark_notification_read', async () => {
    enqueue({ kind: 'mark_notification_read', notificationId: 'n-1' });
    mApi.post.mockResolvedValueOnce({} as never);

    await flushQueue();

    expect(mApi.post).toHaveBeenCalledWith('/notifications/n-1/read');
    expect(loadQueue()).toHaveLength(0);
  });

  it('increments attempts on failure and leaves the entry in the queue', async () => {
    enqueue({ kind: 'create_issue', payload: {}, photos: [] });
    mApi.post.mockRejectedValueOnce(new Error('boom'));

    const r = await flushQueue();

    const queue = loadQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.attempts).toBe(1);
    expect(r).toEqual({ ok: 0, failed: 1 });
  });

  it('moves entry to DLQ after MAX_ATTEMPTS (5) failed attempts', async () => {
    const action = enqueue({ kind: 'create_issue', payload: {}, photos: [] });
    mApi.post.mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 4; i++) {
      // ponytail: each flush re-reads queue so attempts persist; no module reset between iterations.
      //          The 5th call sees attempts=4 → moves to DLQ.
      await flushQueue();
    }
    const r = await flushQueue();

    expect(loadQueue()).toHaveLength(0);
    const dlq = loadDlq();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.id).toBe(action.id);
    expect(dlq[0]!.attempts).toBe(5);
    expect(r.failed).toBe(1);
  });

  it('reports ok+failed counts across a mixed batch', async () => {
    enqueue({ kind: 'create_issue', payload: { i: 1 }, photos: [] });
    enqueue({ kind: 'create_issue', payload: { i: 2 }, photos: [] });
    enqueue({ kind: 'mark_notification_read', notificationId: 'n-3' });
    mApi.post.mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce({} as never);

    const r = await flushQueue();
    expect(r).toEqual({ ok: 2, failed: 1 });
    expect(loadQueue()).toHaveLength(1); // the failed one remains
  });

  it('returns zeros for an empty queue', async () => {
    const r = await flushQueue();
    expect(r).toEqual({ ok: 0, failed: 0 });
    expect(mApi.post).not.toHaveBeenCalled();
  });
});
