// src/api/hooks/__tests__/usePhoneVerify.test.ts
const mockPost = jest.fn();
const mockSaveTokens = jest.fn();
const mockRegisterMutateAsync = jest.fn();

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});
jest.mock('@/lib/auth', () => ({
  saveTokens: (...args: unknown[]) => mockSaveTokens(...args),
  clearTokens: jest.fn(),
  loadTokens: jest.fn(),
}));
jest.mock('@/api/hooks/useRegisterDevice', () => ({
  useRegisterDevice: () => ({ mutateAsync: (...args: unknown[]) => mockRegisterMutateAsync(...args) }),
  NotificationsPermissionError: class extends Error {},
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
}));

import { ApiError } from '@/api/client';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';
import { NotificationsPermissionError } from '@/api/hooks/useRegisterDevice';

const okResponse = { status: 200, data: { access_token: 'a', refresh_token: 'r' } };

describe('usePhoneVerify — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okResponse);
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('POSTs /auth/phone/verify, persists tokens, and registers device', async () => {
    const mut: any = usePhoneVerify();
    const data = await mut.mutateAsync({ phone: '+15551234567', code: '123456' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/phone/verify',
      { phone: '+15551234567', code: '123456' },
      { skipAuth: true },
    );
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
    expect(mockRegisterMutateAsync).toHaveBeenCalledTimes(1);
    expect(data).toEqual({ access_token: 'a', refresh_token: 'r' });
  });

  it('swallows NotificationsPermissionError so login still succeeds', async () => {
    mockRegisterMutateAsync.mockRejectedValueOnce(new NotificationsPermissionError('denied'));
    const mut: any = usePhoneVerify();
    const data = await mut.mutateAsync({ phone: '+15551234567', code: '123456' });
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
    expect(data).toEqual({ access_token: 'a', refresh_token: 'r' });
  });
});

describe('usePhoneVerify — failure paths', () => {
  beforeEach(() => {
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('surfaces 422 invalid code without persisting tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_code', 'bad otp'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phone: '+15551234567', code: '000000' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces 401 session-expired without persisting tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unauthenticated', 'expired'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phone: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});
