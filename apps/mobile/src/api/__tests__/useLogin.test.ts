// src/api/__tests__/useLogin.test.ts
// GH #46: useLogin POSTs BA's /auth/sign-in/email and persists the BA
// session cookie value (extracted from Set-Cookie) via saveTokens.
const mockPost = jest.fn();
const mockSaveTokens = jest.fn();
const mockRegisterMutateAsync = jest.fn();

jest.mock('@/api/client', () => {
  // ponytail: re-export the real ApiError class so tests can construct it; only apiClient is stubbed.
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
  NotificationsPermissionError: class extends Error {},
}));
jest.mock('@tanstack/react-query', () => ({
  useMutation: (cfg: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
  useQuery: () => ({ data: null, isPending: false }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { ApiError } from '@/api/client';
import { useLogin } from '@/api/hooks/useLogin';

function okSignInHeaders() {
  const h = new Headers();
  h.append('set-cookie', 'better-auth.session_token=ba-session-tok.abc; HttpOnly; Path=/');
  return h;
}

const okSignInResponse = {
  status: 200,
  data: {
    user: { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    redirect: false,
  },
  headers: okSignInHeaders(),
};

describe('useLogin — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okSignInResponse);
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('posts to /auth/sign-in/email and persists the BA session cookie', async () => {
    const mut = useLogin() as unknown as { mutate: (i: unknown) => Promise<unknown> };
    await mut.mutate({ email: 'a@b.com', password: 'pw' });
    expect(mockPost).toHaveBeenCalledWith(
      '/auth/sign-in/email',
      { email: 'a@b.com', password: 'pw' },
      { skipAuth: true },
    );
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-session-tok.abc' });
  });

  it('returns the parsed sign-in data via mutateAsync', async () => {
    const mut = useLogin() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    const data = await mut.mutateAsync({ email: 'a@b.com', password: 'pw' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-session-tok.abc' });
    expect(data).toEqual(okSignInResponse.data);
  });
});

describe('useLogin — failure paths', () => {
  beforeEach(() => {
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('propagates a 401 ApiError and does NOT persist tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'bad creds'));
    const mut = useLogin() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('propagates a 4xx ApiError (e.g. 422 validation)', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_payload', 'bad shape'));
    const mut = useLogin() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('throws when the sign-in response omits the session cookie', async () => {
    mockPost.mockReset().mockResolvedValueOnce({ status: 200, data: okSignInResponse.data, headers: new Headers() });
    const mut = useLogin() as unknown as { mutateAsync: (i: unknown) => Promise<unknown> };
    await expect(
      mut.mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ status: 500, code: 'auth.no_session' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});