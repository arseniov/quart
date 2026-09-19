// src/api/hooks/__tests__/useTopics.test.ts
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/api/client', () => ({
  apiClient: { get: jest.fn() },
}));

import { apiClient } from '@/api/client';
import { useTopics } from '@/api/hooks/useTopics';

const mGet = apiClient.get as jest.Mock;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const fakeTopics = [
  { id: 't1', code: 'mobility', name_i18n: { it: 'Mobilità', en: 'Mobility' }, category_id: 'c1' },
  { id: 't2', code: 'safety', name_i18n: { it: 'Sicurezza', en: 'Safety' }, category_id: 'c1' },
];

describe('useTopics', () => {
  beforeEach(() => mGet.mockReset());

  it('fetches /topics on mount and returns the mocked topics', async () => {
    mGet.mockResolvedValue({ status: 200, data: { topics: fakeTopics } });
    const { result } = renderHook(() => useTopics(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mGet).toHaveBeenCalledWith('/topics');
    expect(result.current.data).toEqual(fakeTopics);
  });

  it('surfaces an error when apiClient.get rejects', async () => {
    mGet.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTopics(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('boom');
  });
});
