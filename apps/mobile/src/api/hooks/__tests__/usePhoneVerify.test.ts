// src/api/hooks/__tests__/usePhoneVerify.test.ts
// GH #30 + GH #46: /auth/phone/verify now returns only the Quart user
// projection (BA owns the bearer). The hook does NOT persist tokens —
// the BA session cookie handling for phone-OTP is a follow-up.

const mockPost = jest.fn();
const mockRegisterMutateAsync = jest.fn();

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});
jest.mock('@/lib/auth', () => ({
  saveTokens: jest.fn(),
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
  useMutation: (cfg: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
}));

import { ApiError } from '@/api/client';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';

const okResponse = {
  status: 200,
  data: {
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
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('POSTs /auth/phone/verify with phone + code + fingerprint and returns the user projection', async () => {
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    const data = await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/phone/verify',
      { phoneNumber: '+15551234567', code: '123456', device_fingerprint: 'fp' },
      { skipAuth: true },
    );
    expect(data).toEqual(okResponse.data);
  });

  it('fires the device-register hook after the verify succeeds', async () => {
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockRegisterMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('swallows NotificationsPermissionError thrown by register — verify still succeeds', async () => {
    // Import the mocked class so the instanceof check matches.
    const { NotificationsPermissionError } = jest.requireMock('@/api/hooks/useRegisterDevice');
    mockRegisterMutateAsync.mockReset().mockRejectedValueOnce(
      new NotificationsPermissionError('denied'),
    );
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    const data = await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(data).toEqual(okResponse.data);
  });
});

describe('usePhoneVerify — failure paths', () => {
  beforeEach(() => {
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('surfaces 422 invalid code', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_code', 'bad otp'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '000000' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces 401 unknown-user', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unknown_user', 'no account'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('surfaces offline / network errors', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(0, 'network', 'Network request failed'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});