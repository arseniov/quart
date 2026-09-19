// src/api/__tests__/useNotifications.test.ts
jest.mock('@/api/notifications', () => ({
  markNotificationRead: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/client', () => ({
  apiClient: {
    get: jest.fn().mockResolvedValue({ status: 200, data: { notifications: [] } }),
  },
}));

const mockQc = {
  cancelQueries: jest.fn().mockResolvedValue(undefined),
  getQueryData: jest.fn().mockReturnValue([
    { id: 'n1', read_at: null, type: 'x', title: 't', body: 'b', target_url: null, created_at: '2026-09-17T00:00:00Z' },
  ]),
  setQueryData: jest.fn(),
  invalidateQueries: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({ data: [], isPending: false }),
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => mockQc,
}));

import { useMarkNotificationRead, useNotifications } from '@/api/hooks/useNotifications';
import { markNotificationRead } from '@/api/notifications';

const mMark = markNotificationRead as jest.Mock;

beforeEach(() => {
  mMark.mockClear();
  mockQc.setQueryData.mockClear();
});

describe('useMarkNotificationRead', () => {
  it('optimistic update marks read_at then reverts on error', async () => {
    const mut = useMarkNotificationRead() as any;
    const ctx = await mut.onMutate('n1');
    expect(mockQc.cancelQueries).toHaveBeenCalled();
    expect(mockQc.setQueryData).toHaveBeenCalled();
    await mut.onError(new Error('boom'), 'n1', ctx);
    expect(mockQc.setQueryData).toHaveBeenCalledTimes(2);
    await mut.onSettled();
    expect(mockQc.invalidateQueries).toHaveBeenCalled();
  });

  it('mutationFn delegates to the shared markNotificationRead helper', async () => {
    const mut = useMarkNotificationRead() as any;
    await mut.mutationFn('n1');
    expect(mMark).toHaveBeenCalledTimes(1);
    expect(mMark).toHaveBeenCalledWith('n1');
  });
});

describe('useNotifications', () => {
  it('exposes query hook without throwing', () => {
    expect(() => useNotifications()).not.toThrow();
  });
});
