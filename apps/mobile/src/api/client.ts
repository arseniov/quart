// src/api/client.ts
// GH #46: apiClient sends the BA session token as `Authorization: Bearer <token>`
// on every authenticated request. BA owns session lifetime + refresh server-side
// (BaAuthGuard resolves via `auth.api.getSession({ headers })`), so the mobile
// no longer needs a refresh dance. On 401 the request surfaces ApiError(401)
// and the caller routes the user back to /login.
import { deviceFingerprint } from '@/lib/device-fingerprint';
import { loadTokens } from '@/lib/auth';
import { BASE_URL } from '@/lib/env';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: unknown) {
    super(message);
  }
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  skipAuth?: boolean;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': await deviceFingerprint(),
    'X-Client-Platform': 'mobile',
  };
  if (!opts.skipAuth) {
    const tokens = loadTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.baSessionToken}`;
  }

  const r = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });

  const text = await r.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);
  if (!r.ok) {
    const err = (data as unknown as { code?: string; message?: string }) ?? {};
    throw new ApiError(r.status, err.code ?? 'http_error', err.message ?? r.statusText, data);
  }
  return { status: r.status, data, headers: r.headers };
}

export const apiClient = {
  get: <T>(p: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(p, { ...opts, method: 'GET' }),
  post: <T>(p: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(p, { ...opts, method: 'POST', body }),
  put: <T>(p: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(p, { ...opts, method: 'PUT', body }),
  patch: <T>(p: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    apiFetch<T>(p, { ...opts, method: 'PATCH', body }),
  del: <T>(p: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(p, { ...opts, method: 'DELETE' }),
};