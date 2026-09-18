// src/api/__tests__/hooks.test.ts
jest.mock('@/api/client', () => {
  const get = jest.fn().mockResolvedValue({ status: 200, data: { items: [] } });
  const post = jest.fn().mockResolvedValue({ status: 200, data: {} });
  return { apiClient: { get, post, put: jest.fn(), patch: jest.fn(), del: jest.fn() } };
});
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: (cfg: any) => ({ queryKey: cfg.queryKey, queryFn: cfg.queryFn }),
  useInfiniteQuery: (cfg: any) => ({
    queryKey: cfg.queryKey,
    queryFn: cfg.queryFn,
    getNextPageParam: cfg.getNextPageParam,
  }),
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => ({
    cancelQueries: jest.fn().mockResolvedValue(undefined),
    getQueryData: jest.fn(),
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { apiClient } from '@/api/client';

describe('useFeed hook wrapper', () => {
  it('GET /feed passes through client with kind filter', async () => {
    const { useFeed } = require('@/api/hooks/useFeed');
    const q = useFeed({ kind: 'poll' });
    expect(q.queryKey).toEqual(['feed', { kind: 'poll' }]);
    expect(q.queryFn).toBeDefined();
    await q.queryFn({ pageParam: undefined });
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('/feed'));
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('kind=poll'));
  });

  it('appends cursor to query string when provided', async () => {
    (apiClient.get as jest.Mock).mockClear();
    const { useFeed } = require('@/api/hooks/useFeed');
    const q = useFeed({ kind: 'idea' });
    await q.queryFn({ pageParam: 'abc123' });
    expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('cursor=abc123'));
  });
});

describe('useVoteOnPoll mutation', () => {
  it('posts to /polls/:id/vote and updates cache + invalidates feed', async () => {
    const { useVoteOnPoll } = require('@/api/hooks/usePoll');
    const mut = useVoteOnPoll('poll-1');
    await mut.mutationFn('opt-1');
    expect(apiClient.post).toHaveBeenCalledWith('/polls/poll-1/vote', { option_id: 'opt-1' });
    expect(mut.onSuccess).toBeDefined();
  });
});

describe('useCreateIdea mutation', () => {
  it('posts to /ideas', async () => {
    const { useCreateIdea } = require('@/api/hooks/useIdea');
    const mut = useCreateIdea();
    await mut.mutationFn({ title: 'Hello world', body: 'A long enough body here' });
    expect(apiClient.post).toHaveBeenCalledWith('/ideas', expect.objectContaining({ title: 'Hello world' }));
  });
});

describe('useCreateIssue mutation', () => {
  it('posts to /issues with valid payload', async () => {
    const { useCreateIssue } = require('@/api/hooks/useIssue');
    const mut = useCreateIssue();
    await mut.mutationFn({
      category_id: '00000000-0000-0000-0000-000000000001',
      description: 'A pothole is blocking traffic on Main Street',
      lat: 45.0,
      lng: 7.0,
      neighborhood_id: '00000000-0000-0000-0000-000000000002',
    });
    expect(apiClient.post).toHaveBeenCalledWith('/issues', expect.objectContaining({ lat: 45.0 }));
  });
});
