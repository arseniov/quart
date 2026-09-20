// src/api/__tests__/useSocialLogin.test.ts
// GH #46 + GH #48: useSocialLogin POSTs BA's /auth/sign-in/social with the
// nested `{ provider, idToken: { token } }` body shape BA 1.0.20 expects
// (see better-auth/auth-B_LFm6_Y.d.ts:1582). After the response, extract
// the BA session cookie via extractBaSessionToken and persist it via
// saveTokens — same pattern as useLogin + useSignup.
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
jest.mock('@/lib/storage', () => ({
  mmkvStorage: {
    getItem: jest.fn().mockReturnValue(null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('@/api/hooks/useRegisterDevice', () => ({
  useRegisterDevice: () => ({ mutateAsync: (...args: unknown[]) => mockRegisterMutateAsync(...args) }),
  // Real class export so the `instanceof NotificationsPermissionError`
  // check in the hook matches.
  NotificationsPermissionError: class extends Error {},
}));
jest.mock('@tanstack/react-query', () => ({
  useMutation: (cfg: { mutationFn: (...args: unknown[]) => unknown; onSuccess?: (...args: unknown[]) => unknown }) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
    onSuccess: cfg.onSuccess,
  }),
  useQuery: () => ({ data: null, isPending: false }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { ApiError } from '@/api/client';
import { mmkvStorage } from '@/lib/storage';
import { useSocialLogin } from '@/api/hooks/useSocialLogin';

function okSignInHeaders() {
  const h = new Headers();
  h.append('set-cookie', 'better-auth.session_token=ba-session-tok.abc; HttpOnly; Path=/');
  return h;
}

describe('useSocialLogin — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ status: 200, data: { ok: true }, headers: okSignInHeaders() });
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('posts to /auth/sign-in/social with apple provider + nested idToken { token } + persists BA cookie', async () => {
    const mut = useSocialLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await mut.mutate({ provider: 'apple', idToken: 'apple-tok' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/sign-in/social',
      { provider: 'apple', idToken: { token: 'apple-tok' } },
      { skipAuth: true },
    );
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-session-tok.abc' });
  });

  it('posts to /auth/sign-in/social with google provider + nested idToken + persists BA cookie', async () => {
    const mut = useSocialLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await mut.mutate({ provider: 'google', idToken: 'google-tok' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/sign-in/social',
      { provider: 'google', idToken: { token: 'google-tok' } },
      { skipAuth: true },
    );
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-session-tok.abc' });
  });

  it('persists appleUserId under quart.apple.user.v1 when provided', async () => {
    const mut = useSocialLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await mut.mutate({ provider: 'apple', idToken: 'tok', userId: 'apple.user.123' });
    expect(mmkvStorage.setItem).toHaveBeenCalledWith('quart.apple.user.v1', 'apple.user.123');
  });

  it('does not persist google user id (no platform requirement)', async () => {
    (mmkvStorage.setItem as jest.Mock).mockClear();
    const mut = useSocialLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await mut.mutate({ provider: 'google', idToken: 'tok', userId: 'g.id' });
    expect(mmkvStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('useSocialLogin — failure paths', () => {
  beforeEach(() => {
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('throws auth.no_session when the server response omits the BA session cookie', async () => {
    mockPost.mockReset().mockResolvedValueOnce({ status: 200, data: { ok: true }, headers: new Headers() });
    const mut = useSocialLogin() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ provider: 'apple', idToken: 'tok' }),
    ).rejects.toMatchObject({ status: 500, code: 'auth.no_session' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('propagates real apiClient errors (e.g. 401) for caller to surface via Alert', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'bad token'));
    const mut = useSocialLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutate({ provider: 'google', idToken: 'bad' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});