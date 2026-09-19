// src/api/hooks/__tests__/useCompleteOnboarding.test.ts

const mockPost = jest.fn();
const mockInvalidate = jest.fn().mockResolvedValue(undefined);

jest.mock('@/api/client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) }),
}));

import { useCompleteOnboarding } from '@/api/hooks/useCompleteOnboarding';
import { queryKeys } from '@/api/query-client';

describe('useCompleteOnboarding', () => {
  beforeEach(() => {
    mockPost.mockClear();
    mockInvalidate.mockClear();
  });

  it('mutationFn POSTs /me/onboarding with the supplied input exactly once', async () => {
    mockPost.mockResolvedValue({ status: 200, data: {} });
    const mut: any = useCompleteOnboarding();
    const input = {
      city_id: 'c1',
      neighborhood_id: 'n1',
      topic_ids: ['t1', 't2'],
      preferred_locale: 'en',
    };
    await mut.mutationFn(input);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/me/onboarding', input);
  });

  it('onSuccess invalidates queryKeys.me()', () => {
    mockPost.mockResolvedValue({ status: 200, data: {} });
    const mut: any = useCompleteOnboarding();
    mut.onSuccess();
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me() });
  });

  it('does NOT invalidate any query when apiClient.post rejects', async () => {
    mockPost.mockRejectedValueOnce(new Error('boom'));
    const mut: any = useCompleteOnboarding();
    await expect(
      mut.mutationFn({
        city_id: 'c1',
        neighborhood_id: 'n1',
        topic_ids: [],
        preferred_locale: 'it',
      }),
    ).rejects.toThrow('boom');
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
