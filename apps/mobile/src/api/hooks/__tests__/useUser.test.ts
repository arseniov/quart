// src/api/hooks/__tests__/useUser.test.ts
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/api/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(s: number, c: string, m: string) {
      super(m);
      this.status = s;
      this.code = c;
    }
  }
  return {
    apiClient: { get: jest.fn() },
    ApiError,
  };
});

import { ApiError, apiClient } from '@/api/client';
import { useUser } from '@/api/hooks/useUser';

const mGet = apiClient.get as jest.Mock;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const fakeUser = {
  id: '11111111-1111-1111-1111-111111111111',
  handle: 'alice',
  displayName: 'Alice',
  avatarUrl: 'https://cdn.example/avatar.png',
  joinedAt: '2026-01-15T08:00:00.000Z',
  publicStats: { ideasCount: 4, issuesCount: 2, pollsCount: 1 },
};

describe('useUser', () => {
  beforeEach(() => mGet.mockReset());

  it('fetches /users/:id on mount and returns the mocked public profile', async () => {
    mGet.mockResolvedValue({ status: 200, data: fakeUser });
    const { result } = renderHook(() => useUser(fakeUser.id), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mGet).toHaveBeenCalledWith(`/users/${encodeURIComponent(fakeUser.id)}`);
    expect(result.current.data).toEqual(fakeUser);
  });

  it('does NOT request when id is undefined', async () => {
    const { result } = renderHook(() => useUser(undefined), { wrapper: makeWrapper() });
    // enabled=false → no fetch happens
    expect(mGet).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });

  it('surfaces a 404 error (does not swallow it)', async () => {
    mGet.mockRejectedValue(new ApiError(404, 'user.not_found', 'user not found'));
    const { result } = renderHook(() => useUser('missing'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(404);
  });

  it('surfaces a 410 (soft-deleted) error as a normal failure', async () => {
    mGet.mockRejectedValue(new ApiError(410, 'user.gone', 'user deleted'));
    const { result } = renderHook(() => useUser('gone'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(410);
  });

  it('surfaces a network error', async () => {
    mGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useUser('any'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});
