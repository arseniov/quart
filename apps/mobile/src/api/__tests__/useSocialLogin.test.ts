// src/api/__tests__/useSocialLogin.test.ts
jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn().mockResolvedValue({ status: 200, data: { access_token: 'a', refresh_token: 'r' } }) },
}));
jest.mock('@/lib/auth', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
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
  useRegisterDevice: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
  NotificationsPermissionError: class extends Error {},
}));
jest.mock('@tanstack/react-query', () => ({
  useMutation: (cfg: any) => ({ mutate: cfg.mutationFn, mutateAsync: cfg.mutationFn, onSuccess: cfg.onSuccess }),
  useQuery: () => ({ data: null, isPending: false }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: any) => children,
}));

import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';
import { mmkvStorage } from '@/lib/storage';
import { useSocialLogin } from '@/api/hooks/useSocialLogin';

describe('useSocialLogin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts to /auth/sign-in/social with apple provider + idToken', async () => {
    const mut = useSocialLogin();
    await (mut as any).mutate({ provider: 'apple', idToken: 'apple-tok' });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/auth/sign-in/social',
      { provider: 'apple', idToken: 'apple-tok' },
      { skipAuth: true },
    );
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('posts to /auth/sign-in/social with google provider + idToken', async () => {
    (apiClient.post as jest.Mock).mockClear();
    (saveTokens as jest.Mock).mockClear();
    const mut = useSocialLogin();
    await (mut as any).mutate({ provider: 'google', idToken: 'google-tok' });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/auth/sign-in/social',
      { provider: 'google', idToken: 'google-tok' },
      { skipAuth: true },
    );
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });

  it('persists appleUserId under quart.apple.user.v1 when provided', async () => {
    (mmkvStorage.setItem as jest.Mock).mockClear();
    const mut = useSocialLogin();
    await (mut as any).mutate({ provider: 'apple', idToken: 'tok', userId: 'apple.user.123' });
    expect(mmkvStorage.setItem).toHaveBeenCalledWith('quart.apple.user.v1', 'apple.user.123');
  });

  it('does not persist google user id (no platform requirement)', async () => {
    (mmkvStorage.setItem as jest.Mock).mockClear();
    const mut = useSocialLogin();
    await (mut as any).mutate({ provider: 'google', idToken: 'tok', userId: 'g.id' });
    expect(mmkvStorage.setItem).not.toHaveBeenCalled();
  });

  it('propagates real apiClient errors (e.g. 401) for caller to surface via Alert', async () => {
    (apiClient.post as jest.Mock).mockRejectedValueOnce(new Error('bad token'));
    const mut = useSocialLogin();
    await expect(
      (mut as any).mutate({ provider: 'google', idToken: 'bad' }),
    ).rejects.toThrow('bad token');
    expect(saveTokens).not.toHaveBeenCalled();
  });
});