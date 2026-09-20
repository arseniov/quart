// src/api/hooks/__tests__/usePhoneVerify.test.ts
// GH #30: /auth/phone/verify now returns the full session shape and the
// hook persists tokens via saveTokens + fires the device-register hook
// (swallowing NotificationsPermissionError).

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
jest.mock('@/lib/device-fingerprint', () => ({ deviceFingerprint: jest.fn().mockResolvedValue('fp') }));
jest.mock('@/api/hooks/useRegisterDevice', () => ({
  useRegisterDevice: () => ({ mutateAsync: (...args: unknown[]) => mockRegisterMutateAsync(...args) }),
  // Real class export so instanceof checks in the hook match — mirrors useLogin.test.ts.
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

const okResponse = {
  status: 200,
  data: {
    access_token: 'a',
    refresh_token: 'r',
    refresh_expires_at: '2030-01-01T00:00:00.000Z',
    user: {
      id: 'u',
      handle: 'h',
      display_name: 'd',
      email: null,
      phone_e164: '+15551234567',
      avatar_url: null,
      preferred_locale: 'en',
      city_id: 'c',
      needs_onboarding: false,
      roles: ['citizen'],
    },
  },
};

describe('usePhoneVerify — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okResponse);
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('POSTs /auth/phone/verify with phone + code + fingerprint, persists tokens', async () => {
    const mut: any = usePhoneVerify();
    const data = await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/phone/verify',
      { phoneNumber: '+15551234567', code: '123456', device_fingerprint: 'fp' },
      { skipAuth: true },
    );
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
    expect(data).toEqual(okResponse.data);
  });

  it('fires the device-register hook after persisting tokens', async () => {
    const mut: any = usePhoneVerify();
    await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockRegisterMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('swallows NotificationsPermissionError thrown by register — sign-in still succeeds', async () => {
    // Import the mocked class so the instanceof check matches.
    const { NotificationsPermissionError } = jest.requireMock('@/api/hooks/useRegisterDevice');
    mockRegisterMutateAsync.mockReset().mockRejectedValueOnce(
      new NotificationsPermissionError('denied'),
    );
    const mut: any = usePhoneVerify();
    const data = await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
    expect(data).toEqual(okResponse.data);
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
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '000000' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces 401 unknown-user without persisting tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unknown_user', 'no account'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces offline / network errors without persisting tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(0, 'network', 'Network request failed'));
    const mut: any = usePhoneVerify();
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});
