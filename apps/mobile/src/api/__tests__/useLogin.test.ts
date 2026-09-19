// src/api/__tests__/useLogin.test.ts

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
  useMutation: (cfg: any) => ({
    mutate: cfg.mutationFn,
    mutateAsync: cfg.mutationFn,
  }),
  useQuery: () => ({ data: null, isPending: false }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: any) => children,
}));

import { ApiError } from '@/api/client';
import { useLogin } from '@/api/hooks/useLogin';

const okResponse = { status: 200, data: { access_token: 'a', refresh_token: 'r' } };

describe('useLogin — happy path', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue(okResponse);
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('posts and persists tokens via mutate', async () => {
    const mut = useLogin();
    await (mut as any).mutate({ email: 'a@b.com', password: 'pw' });
    expect(mockPost).toHaveBeenCalledWith('/auth/login', expect.any(Object), { skipAuth: true });
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('posts and persists tokens via mutateAsync (returns resolved data)', async () => {
    const mut = useLogin();
    const data = await (mut as any).mutateAsync({ email: 'a@b.com', password: 'pw' });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
    expect(data).toEqual({ access_token: 'a', refresh_token: 'r' });
  });
});

describe('useLogin — failure paths', () => {
  beforeEach(() => {
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('propagates a network throw and does NOT persist tokens (mutateAsync)', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new Error('network down'));
    const mut = useLogin();
    await expect(
      (mut as any).mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toThrow('network down');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('propagates a 401 ApiError and does NOT persist tokens', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'bad creds'));
    const mut = useLogin();
    await expect(
      (mut as any).mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  it('propagates a 4xx ApiError (e.g. 422 validation)', async () => {
    mockPost.mockReset().mockRejectedValueOnce(new ApiError(422, 'invalid_payload', 'bad shape'));
    const mut = useLogin();
    await expect(
      (mut as any).mutateAsync({ email: 'a@b.com', password: 'pw' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});
