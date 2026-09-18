// src/lib/__tests__/issue-offline.test.ts
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => {
      counter += 1;
      const hex = counter.toString(16).padStart(12, '0');
      return `22222222-2222-4222-8222-${hex}`;
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

// ponytail: mock ONLY apiClient.post, import the REAL ApiError class so `e instanceof ApiError`
//          narrows correctly in production code. (Plan-defect 3.)
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return {
    ...actual,
    apiClient: {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      del: jest.fn(),
    },
  };
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';
import React from 'react';
import { ApiError, apiClient } from '@/api/client';
import { OfflineQueuedError, useCreateIssue } from '@/api/hooks/useIssue';
import { loadQueue } from '@/lib/offline-queue';
import { mmkv } from '@/lib/storage';

const mApi = apiClient as jest.Mocked<typeof apiClient>;
const mMmkv = mmkv as unknown as { clearAll: () => void };

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  mMmkv.clearAll();
  jest.clearAllMocks();
});

describe('useCreateIssue offline fallback', () => {
  it('enqueues and throws OfflineQueuedError when the network fails (status 0)', async () => {
    mApi.post.mockRejectedValueOnce(new ApiError(0, 'network_error', 'offline'));

    const { result } = renderHook(() => useCreateIssue(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          category_id: 'c1',
          description: 'broken streetlight',
          lat: 0,
          lng: 0,
          neighborhood_id: '00000000-0000-0000-0000-000000000000',
          photo_object_keys: [],
          address_hint: undefined,
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(OfflineQueuedError);
    const q = loadQueue();
    expect(q).toHaveLength(1);
    expect(q[0]!.kind).toBe('create_issue');
    expect(q[0]!.attempts).toBe(0);
  });

  it('enqueues on transient 5xx and throws OfflineQueuedError', async () => {
    mApi.post.mockRejectedValueOnce(new ApiError(502, 'bad_gateway', 'try again'));

    const { result } = renderHook(() => useCreateIssue(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          category_id: 'c1',
          description: 'd',
          lat: 0,
          lng: 0,
          neighborhood_id: '00000000-0000-0000-0000-000000000000',
          photo_object_keys: [],
          address_hint: undefined,
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(OfflineQueuedError);
    expect(loadQueue()).toHaveLength(1);
  });

  it('rethrows validation 4xx as ApiError without enqueuing', async () => {
    const validationError = new ApiError(422, 'unprocessable_entity', 'invalid');
    mApi.post.mockRejectedValueOnce(validationError);

    const { result } = renderHook(() => useCreateIssue(), { wrapper: makeWrapper() });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          category_id: 'c1',
          description: 'd',
          lat: 0,
          lng: 0,
          neighborhood_id: '00000000-0000-0000-0000-000000000000',
          photo_object_keys: [],
          address_hint: undefined,
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBe(validationError);
    expect(loadQueue()).toHaveLength(0);
  });

  it('returns the freshly-created Issue when the network succeeds', async () => {
    const issue = {
      id: '33333333-3333-4333-8333-333333333333',
      status: 'open',
    } as never;
    mApi.post.mockResolvedValueOnce({ data: { issue } } as never);

    const { result } = renderHook(() => useCreateIssue(), { wrapper: makeWrapper() });

    let ret: unknown;
    await act(async () => {
      ret = await result.current.mutateAsync({
        category_id: 'c1',
        description: 'd',
        lat: 0,
        lng: 0,
        neighborhood_id: '00000000-0000-0000-0000-000000000000',
        photo_object_keys: [],
        address_hint: undefined,
      });
    });

    expect(ret).toEqual(issue);
    expect(loadQueue()).toHaveLength(0);
  });
});
