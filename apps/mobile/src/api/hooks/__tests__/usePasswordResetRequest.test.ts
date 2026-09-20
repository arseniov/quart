// src/api/hooks/__tests__/usePasswordResetRequest.test.ts
const mockPost = jest.fn();
jest.mock('@/api/client', () => ({
  apiClient: { post: (...args: unknown[]) => mockPost(...args) },
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
}));

import { usePasswordResetRequest } from '@/api/hooks/usePasswordResetRequest';

describe('usePasswordResetRequest', () => {
  beforeEach(() => mockPost.mockReset());

  it('POSTs /auth/password/reset-request with the email, skipAuth', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: {} });
    const mut: any = usePasswordResetRequest();
    await mut.mutate({ email: 'a@b.com' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/password/reset-request',
      { email: 'a@b.com' },
      { skipAuth: true },
    );
  });

  it('propagates a network throw', async () => {
    mockPost.mockRejectedValueOnce(new Error('boom'));
    const mut: any = usePasswordResetRequest();
    await expect(mut.mutate({ email: 'a@b.com' })).rejects.toThrow('boom');
  });
});
