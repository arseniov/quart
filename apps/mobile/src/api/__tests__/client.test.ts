// src/api/__tests__/client.test.ts
jest.mock('@/lib/auth', () => ({
  loadTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
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
  (globalThis as any).fetch = jest.fn();
});

describe('apiClient.get', () => {
  it('returns parsed JSON on 200', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(okResponse({ id: 1 }));
    const r = await apiClient.get<{ id: number }>('/test');
    expect(r.data).toEqual({ id: 1 });
    expect(r.status).toBe(200);
  });

  it('retries once after successful refresh on 401', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(emptyResponse(401))
      .mockResolvedValueOnce(okResponse({ access_token: 'fresh', refresh_token: 'fresh-r' }))
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const r = await apiClient.get('/test', { skipAuth: false });
    expect(r.data).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('throws ApiError(401) when refresh also fails', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(emptyResponse(401))
      .mockResolvedValueOnce(emptyResponse(401));

    await expect(apiClient.get('/test')).rejects.toMatchObject({
      status: 401,
      code: 'unauthenticated',
    });
  });

  it('does not refresh when skipAuth=true', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(emptyResponse(401));
    await expect(apiClient.get('/test', { skipAuth: true })).rejects.toMatchObject({
      status: 401,
      code: 'http_error',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});