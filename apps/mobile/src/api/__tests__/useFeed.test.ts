jest.mock('@/api/client', () => ({
  apiClient: {
    get: jest.fn().mockImplementation((url: string) => {
      if (url.includes('cursor=abc')) {
        return Promise.resolve({ status: 200, data: { items: [{ id: 'b', kind: 'idea', title: 'b' }], next_cursor: null } });
      }
      return Promise.resolve({ status: 200, data: { items: [{ id: 'a', kind: 'poll', title: 'a' }], next_cursor: 'abc' } });
    }),
  },
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useInfiniteQuery: (cfg: any) => ({
    queryKey: cfg.queryKey,
    queryFn: cfg.queryFn,
    getNextPageParam: cfg.getNextPageParam,
  }),
}));

describe('useFeed shape + pagination', () => {
  it('exposes queryKey and queryFn', () => {
    const { useFeed } = require('@/api/hooks/useFeed');
    const q: any = useFeed();
    expect(q.queryKey).toBeDefined();
    expect(typeof q.queryFn).toBe('function');
  });

  it('queryFn returns FeedPage with items + next_cursor', async () => {
    const { useFeed } = require('@/api/hooks/useFeed');
    const q: any = useFeed();
    const page = await q.queryFn({ pageParam: undefined });
    expect(Array.isArray(page.items)).toBe(true);
    expect(page.items[0].id).toBe('a');
    expect(page.next_cursor).toBe('abc');
  });

  it('queryFn accepts cursor for next page', async () => {
    const { useFeed } = require('@/api/hooks/useFeed');
    const q: any = useFeed();
    const page = await q.queryFn({ pageParam: 'abc' });
    expect(page.items[0].id).toBe('b');
    expect(page.next_cursor).toBe(null);
  });
});
