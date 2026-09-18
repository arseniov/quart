// src/api/__tests__/useLogin.test.ts
jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn().mockResolvedValue({ status: 200, data: { access_token: 'a', refresh_token: 'r' } }) },
}));
jest.mock('@/lib/auth', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn(),
  loadTokens: jest.fn(),
}));
jest.mock('@/lib/device-fingerprint', () => ({ deviceFingerprint: jest.fn().mockResolvedValue('fp') }));
jest.mock('@tanstack/react-query', () => ({
  useMutation: (cfg: any) => ({ mutate: cfg.mutationFn }),
  useQuery: () => ({ data: null, isPending: false }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: any) => children,
}));

import { useLogin } from '@/api/hooks/useLogin';
import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';

describe('useLogin', () => {
  it('posts and persists tokens', async () => {
    const mut = useLogin();
    await (mut as any).mutate({ email: 'a@b.com', password: 'pw' });
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', expect.any(Object), { skipAuth: true });
    expect(saveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' });
  });
});