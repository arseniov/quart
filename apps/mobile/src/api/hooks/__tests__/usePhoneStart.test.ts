// src/api/hooks/__tests__/usePhoneStart.test.ts
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

import { usePhoneStart } from '@/api/hooks/usePhoneStart';

describe('usePhoneStart', () => {
  beforeEach(() => mockPost.mockReset());

  it('POSTs /auth/phone/start with the phone number, skipAuth', async () => {
    mockPost.mockResolvedValueOnce({ status: 200, data: {} });
    const mut: any = usePhoneStart();
    await mut.mutate({ phone: '+15551234567' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/phone/start',
      { phone: '+15551234567' },
      { skipAuth: true },
    );
  });

  it('propagates an idempotent retry error (e.g. 429 throttled)', async () => {
    mockPost.mockRejectedValueOnce(new Error('throttled'));
    const mut: any = usePhoneStart();
    await expect(mut.mutate({ phone: '+15551234567' })).rejects.toThrow('throttled');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
