jest.mock('@/api/client', () => ({
  apiClient: {
    post: jest.fn().mockResolvedValue({
      status: 200,
      data: { idea: { id: 'i', upvotes: 11, user_upvoted: true } },
    }),
  },
}));

const mockQc = {
  cancelQueries: jest.fn().mockResolvedValue(undefined),
  getQueryData: jest.fn().mockReturnValue({
    idea: { id: 'i', upvotes: 10, user_upvoted: false },
    comments: [],
  }),
  setQueryData: jest.fn(),
  invalidateQueries: jest.fn(),
};

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => mockQc,
}));

import { useUpvoteIdea } from '@/api/hooks/useIdea';

describe('useUpvoteIdea optimistic update', () => {
  beforeEach(() => {
    mockQc.cancelQueries.mockClear();
    mockQc.getQueryData.mockClear();
    mockQc.setQueryData.mockClear();
    mockQc.invalidateQueries.mockClear();
  });

  it('exposes a mutationFn', () => {
    const mut = useUpvoteIdea('i') as any;
    expect(typeof mut.mutationFn).toBe('function');
  });

  it('onMutate snapshots and optimistically increments upvotes', async () => {
    const mut = useUpvoteIdea('i') as any;
    const ctx = await mut.onMutate();
    expect(mockQc.cancelQueries).toHaveBeenCalledWith({ queryKey: ['idea', 'i'] });
    expect(mockQc.setQueryData).toHaveBeenCalledWith(
      ['idea', 'i'],
      expect.objectContaining({
        idea: expect.objectContaining({ upvotes: 11, user_upvoted: true }),
      }),
    );
    expect(ctx).toEqual({ prev: { idea: { id: 'i', upvotes: 10, user_upvoted: false }, comments: [] } });
  });

  it('onError rolls back to snapshot', () => {
    const mut = useUpvoteIdea('i') as any;
    const ctx = { prev: { idea: { id: 'i', upvotes: 10, user_upvoted: false }, comments: [] } };
    mut.onError(new Error('boom'), undefined, ctx);
    expect(mockQc.setQueryData).toHaveBeenLastCalledWith(['idea', 'i'], ctx.prev);
  });

  it('onSettled invalidates the idea query', () => {
    const mut = useUpvoteIdea('i') as any;
    mut.onSettled();
    expect(mockQc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['idea', 'i'] });
  });
});
