// src/api/hooks/__tests__/useSearch.test.ts
// GH #23 — locks down query string shape + the "q is required" enabled gate.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/api/client', () => ({
  apiClient: { get: jest.fn() },
}));

import { apiClient } from '@/api/client';
import { useSearch } from '@/api/hooks/useSearch';

const mGet = apiClient.get as jest.Mock;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const fakeHits = [
  {
    id: 'iss-1',
    kind: 'issue',
    cityId: 'c-1',
    createdAt: '2026-09-17T00:00:00.000Z',
    rank: 0.7,
    title: 'Buca in via Roma',
  },
];

describe('useSearch', () => {
  beforeEach(() => mGet.mockReset());

  it('skips the request when q is empty (no fetch, pending stays true)', () => {
    mGet.mockResolvedValue({ status: 200, data: fakeHits });
    const { result } = renderHook(() => useSearch({ q: '' }), { wrapper: makeWrapper() });
    expect(mGet).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });

  it('hits /search with q + city_id + limit and parses the result', async () => {
    mGet.mockResolvedValue({ status: 200, data: fakeHits });
    const { result } = renderHook(
      () => useSearch({ q: 'buca', city_id: 'c-1' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mGet).toHaveBeenCalledTimes(1);
    const url = mGet.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/search\?/);
    expect(url).toContain('q=buca');
    expect(url).toContain('cityId=c-1');
    expect(url).toContain('limit=20');
    expect(result.current.data).toEqual(fakeHits);
  });

  it('appends neighborhood_id and kind when provided', async () => {
    mGet.mockResolvedValue({ status: 200, data: fakeHits });
    const { result } = renderHook(
      () => useSearch({ q: 'park', city_id: 'c-1', neighborhood_id: 'n-9', kind: 'poll' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mGet.mock.calls[0][0] as string;
    const params = new URL(url, 'http://x').searchParams;
    expect(params.get('neighborhoodId')).toBe('n-9');
    expect(params.get('kind')).toBe('poll');
  });

  it('surfaces a network error from apiClient.get', async () => {
    mGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => useSearch({ q: 'boom' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });

  it('respects explicit enabled=false and skips the network call', () => {
    mGet.mockResolvedValue({ status: 200, data: fakeHits });
    const { result } = renderHook(
      () => useSearch({ q: 'buca' }, { enabled: false }),
      { wrapper: makeWrapper() },
    );
    expect(mGet).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });
});
