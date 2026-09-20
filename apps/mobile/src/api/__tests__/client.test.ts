// src/api/__tests__/client.test.ts
// GH #46: apiClient reads the BA session token from MMKV and sends it as
// `Authorization: Bearer <token>` on every authenticated request. The
// refresh dance is gone — BA owns session lifetime, the mobile just
// surfaces 401 to the caller.
jest.mock('@/lib/auth', () => ({
  loadTokens: jest.fn().mockReturnValue({ baSessionToken: 'ba-session-tok' }),
  saveTokens: jest.fn(),
  clearTokens: jest.fn(),
}));

jest.mock('@/lib/device-fingerprint', () => ({
  deviceFingerprint: jest.fn().mockResolvedValue('fp'),
}));

import { apiClient } from '../client';

const okResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as Response;

const emptyResponse = (status: number, statusText = 'Error') =>
  ({
    ok: false,
    status,
    statusText,
    headers: new Headers(),
    text: async () => '',
  }) as unknown as Response;

beforeEach(() => {
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
});

function lastFetchInit(): { headers: Record<string, string> } {
  const calls = (fetch as jest.Mock).mock.calls;
  return calls[calls.length - 1][1] as { headers: Record<string, string> };
}

describe('apiClient', () => {
  it('returns parsed JSON on 200', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(okResponse({ id: 1 }));
    const r = await apiClient.get<{ id: number }>('/test');
    expect(r.data).toEqual({ id: 1 });
    expect(r.status).toBe(200);
  });

  it('sends Authorization: Bearer <baSessionToken> on authenticated requests', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(okResponse({ ok: true }));
    await apiClient.get('/me');
    expect(lastFetchInit().headers.Authorization).toBe('Bearer ba-session-tok');
  });

  it('omits Authorization when skipAuth=true', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(okResponse({ ok: true }));
    await apiClient.post('/auth/sign-in/email', { email: 'a@b', password: 'pw' }, { skipAuth: true });
    expect(lastFetchInit().headers.Authorization).toBeUndefined();
  });

  it('surfaces 401 as ApiError without retrying through refresh', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(emptyResponse(401));
    await expect(apiClient.get('/me')).rejects.toMatchObject({
      status: 401,
      code: 'http_error',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates ApiError(401, unauthenticated) for the no-token case', async () => {
    const { loadTokens } = jest.requireMock('@/lib/auth');
    (loadTokens as jest.Mock).mockReturnValueOnce(null);
    (fetch as jest.Mock).mockResolvedValueOnce(okResponse({ ok: true }));
    await apiClient.get('/me');
    expect(lastFetchInit().headers.Authorization).toBeUndefined();
  });
});