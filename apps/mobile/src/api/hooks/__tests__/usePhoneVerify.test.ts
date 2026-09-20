// src/api/hooks/__tests__/usePhoneVerify.test.ts
// GH #30 + GH #46 + GH #48: /auth/phone/verify returns the Quart user
// projection AND, when the server can mint a BA session (the Quart user
// has a matching BA `user.email` row), forwards a Set-Cookie. The hook
// extracts the cookie via extractBaSessionToken and persists via
// saveTokens; throws `auth.no_session` when the server omits it (phone-
// only Quart user with no BA account — the mint path returns null).

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
  useMutation: (cfg: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
}));

import { ApiError } from '@/api/client';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';

function okVerifyHeaders() {
  const h = new Headers();
  h.append('set-cookie', 'better-auth.session_token=ba-phone-tok.xyz; HttpOnly; Path=/');
  return h;
}

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
  headers: okVerifyHeaders(),
};

describe('usePhoneVerify — happy path (server forwarded BA Set-Cookie)', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okResponse);
    mockSaveTokens.mockReset();
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

  it('persists the BA session cookie via saveTokens when the server forwards Set-Cookie (GH #48)', async () => {
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' });
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-phone-tok.xyz' });
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
    // saveTokens ran BEFORE the device-register call (cookie persist is
    // not gated on notifications permission), so the happy-path assertion
    // is safe here.
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-phone-tok.xyz' });
  });
});

describe('usePhoneVerify — failure paths', () => {
  beforeEach(() => {
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('throws auth.no_session when the server response omits the BA session cookie (GH #48)', async () => {
    mockPost.mockReset().mockResolvedValueOnce({
      status: 200,
      data: okResponse.data,
      headers: new Headers(),
    });
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 500, code: 'auth.no_session' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces 422 invalid code — saveTokens NOT called', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_code', 'bad otp'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '000000' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces 401 unknown-user — saveTokens NOT called', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unknown_user', 'no account'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('surfaces offline / network errors', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(0, 'network', 'Network request failed'));
    const mut = usePhoneVerify() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ phoneNumber: '+15551234567', code: '123456' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});