// src/api/__tests__/useIdeaComments.test.ts
const mockQc = { invalidateQueries: jest.fn().mockResolvedValue(undefined) };

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: (cfg: any) => cfg,
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => mockQc,
}));

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { useIdeaComments, usePostIdeaComment } from '@/api/hooks/useIdeaComments';
import { queryKeys } from '@/api/query-client';

describe('useIdeaComments query', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      status: 200,
      data: [{ id: 'c1', parentType: 'idea', parentId: 'i1', authorUserId: 'u1', body: 'hi', createdAt: '2026-01-01T10:00:00Z' }],
    });
  });

  it('uses queryKey from queryKeys.ideaComments with the idea id', () => {
    const q: any = useIdeaComments('i1');
    expect(q.queryKey).toEqual(queryKeys.ideaComments('i1'));
    expect(q.queryKey).toEqual(['idea-comments', 'i1']);
  });

  it('staleTime is 30s', () => {
    const q: any = useIdeaComments('i1');
    expect(q.staleTime).toBe(30_000);
  });

  it('queryFn GETs /ideas/:id/comments and returns data', async () => {
    const q: any = useIdeaComments('i1');
    const data = await q.queryFn();
    expect(mockGet).toHaveBeenCalledWith('/ideas/i1/comments');
    expect(data).toEqual([
      { id: 'c1', parentType: 'idea', parentId: 'i1', authorUserId: 'u1', body: 'hi', createdAt: '2026-01-01T10:00:00Z' },
    ]);
  });
});

describe('usePostIdeaComment mutation', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      status: 200,
      data: { id: 'c2', parentType: 'idea', parentId: 'i1', authorUserId: 'me', body: 'hello', createdAt: '2026-01-02T10:00:00Z' },
    });
    mockQc.invalidateQueries.mockClear();
  });

  it('mutationFn POSTs /ideas/:id/comments with body and returns data', async () => {
    const m: any = usePostIdeaComment('i1');
    const out = await m.mutationFn({ body: 'hello' });
    expect(mockPost).toHaveBeenCalledWith('/ideas/i1/comments', { body: 'hello' });
    expect(out).toEqual({
      id: 'c2', parentType: 'idea', parentId: 'i1', authorUserId: 'me', body: 'hello', createdAt: '2026-01-02T10:00:00Z',
    });
  });

  it('onSuccess invalidates the comments query for the same idea', () => {
    const m: any = usePostIdeaComment('i1');
    m.onSuccess();
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.ideaComments('i1') });
  });
});
