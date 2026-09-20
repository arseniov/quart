// src/api/hooks/__tests__/usePhoneVerify.test.ts
const mockPost = jest.fn();

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
}));

import { ApiError } from '@/api/client';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';

const okResponse = { status: 200, data: { verified: true } };

describe('usePhoneVerify — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okResponse);
  });

  it('POSTs /auth/phone/verify with phoneNumber + code and returns { verified }', async () => {
    const mut: any = usePhoneVerify();
    const data = await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/phone/verify',
      { phoneNumber: '+15551234567', code: '123456' },
      { skipAuth: true },
    );
    expect(data).toEqual({ verified: true });
  });
});

describe('usePhoneVerify — failure paths', () => {
  it('surfaces 422 invalid code without persisting tokens (none expected — endpoint has none)', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_code', 'bad otp'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '000000' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces 401 session-expired', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unauthenticated', 'expired'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 401 });
  });
});