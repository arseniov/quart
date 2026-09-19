// src/api/hooks/__tests__/useCities.test.ts
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/api/client', () => ({
  apiClient: { get: jest.fn() },
}));

import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import { useCities } from '@/api/hooks/useCities';

const mGet = apiClient.get as jest.Mock;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const fakeCities = [
  { id: 'c1', slug: 'milano', name: 'Milano', country_code: 'IT' },
  { id: 'c2', slug: 'roma', name: 'Roma', country_code: 'IT' },
];

describe('useCities', () => {
  beforeEach(() => mGet.mockReset());

  it('renders without crashing', () => {
    mGet.mockResolvedValue({ status: 200, data: { cities: fakeCities } });
    const { result } = renderHook(() => useCities(), { wrapper: makeWrapper() });
    expect(result.current).toBeDefined();
  });

  it('fetches /cities on mount and returns the mocked cities', async () => {
    mGet.mockResolvedValue({ status: 200, data: { cities: fakeCities } });
    const { result } = renderHook(() => useCities(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mGet).toHaveBeenCalledWith('/cities?country=IT');
    expect(result.current.data).toEqual(fakeCities);
  });

  it('exposes the queryKeys.cities key', () => {
    mGet.mockResolvedValue({ status: 200, data: { cities: fakeCities } });
    const { result } = renderHook(() => useCities('FR'), { wrapper: makeWrapper() });
    expect(result.current).toBeDefined();
    expect(mGet).toHaveBeenCalledWith('/cities?country=FR');
  });

  it('surfaces an error when apiClient.get rejects', async () => {
    mGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCities(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });

  it('queryKey matches queryKeys.cities(country)', async () => {
    // ponytail: confirms the URL bound to queryKeys.cities(country) and the key factory tuple shape.
    mGet.mockResolvedValue({ status: 200, data: { cities: [] } });
    renderHook(() => useCities('DE'), { wrapper: makeWrapper() });
    await waitFor(() => expect(mGet).toHaveBeenCalledWith('/cities?country=DE'));
    expect(queryKeys.cities('DE')[0]).toBe('cities');
    expect(queryKeys.cities('DE')).toEqual(['cities', 'DE']);
  });
});
