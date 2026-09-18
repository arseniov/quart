// src/api/__tests__/useUpdatePrefs.test.ts
jest.mock('@/api/client', () => ({
  apiClient: {
    patch: jest.fn().mockResolvedValue({ status: 200, data: { preferred_locale: 'en' } }),
    put: jest.fn().mockResolvedValue({ status: 200, data: { topic_ids: ['t1'] } }),
    get: jest.fn().mockResolvedValue({ status: 200, data: { topic_ids: ['t1'] } }),
  },
}));

const mockQc = {
  invalidateQueries: jest.fn().mockResolvedValue(undefined),
  setQueryData: jest.fn(),
  getQueryData: jest.fn(),
  cancelQueries: jest.fn(),
};
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => cfg,
  useQuery: (cfg: any) => cfg,
  useQueryClient: () => mockQc,
}));

import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import { useUpdateMe, useUpdateTopicSubscriptions, useTopicSubscriptions } from '@/api/hooks/useUpdatePrefs';

describe('useUpdateMe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PATCHes /me with preferred_locale', async () => {
    const mut: any = useUpdateMe();
    await mut.mutationFn({ preferred_locale: 'en' });
    expect(apiClient.patch).toHaveBeenCalledWith('/me', { preferred_locale: 'en' });
  });

  it('invalidates me() on success', () => {
    const mut: any = useUpdateMe();
    mut.onSuccess();
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.me() });
  });
});

describe('useTopicSubscriptions', () => {
  it('queries /me/topic-subscriptions', () => {
    const q: any = useTopicSubscriptions();
    expect(q.queryKey).toEqual(queryKeys.topicSubscriptions());
    expect(typeof q.queryFn).toBe('function');
  });
});

describe('useUpdateTopicSubscriptions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PUTs /me/topic-subscriptions with topic_ids', async () => {
    const mut: any = useUpdateTopicSubscriptions();
    await mut.mutationFn(['t1', 't2']);
    expect(apiClient.put).toHaveBeenCalledWith('/me/topic-subscriptions', { topic_ids: ['t1', 't2'] });
  });

  it('invalidates me() and topicSubscriptions() on success', () => {
    const mut: any = useUpdateTopicSubscriptions();
    mut.onSuccess();
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.me() });
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.topicSubscriptions() });
  });
});
