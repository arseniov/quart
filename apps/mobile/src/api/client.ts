// src/api/client.ts
import Constants from 'expo-constants';
import { deviceFingerprint } from '@/lib/device-fingerprint';
import { loadTokens, saveTokens, clearTokens } from '@/lib/auth';

const BASE = (Constants.expoConfig?.extra as { EXPO_PUBLIC_API_URL?: string } | undefined)
  ?.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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

async function refreshAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const r = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Fingerprint': await deviceFingerprint(),
    },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  });
  if (!r.ok) {
    await clearTokens();
    return null;
  }
  const json = (await r.json()) as { access_token: string; refresh_token: string };
  await saveTokens({ accessToken: json.access_token, refreshToken: json.refresh_token });
  return json.access_token;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  skipAuth?: boolean;
  retryOn401?: boolean;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': await deviceFingerprint(),
    'X-Client-Platform': 'mobile',
  };
  if (!opts.skipAuth) {
    const tokens = await loadTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const doFetch = () =>
    fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });

  let r = await doFetch();
  if (r.status === 401 && !opts.skipAuth && opts.retryOn401 !== false) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      headers.Authorization = `Bearer ${fresh}`;
      r = await doFetch();
    } else {
      throw new ApiError(401, 'unauthenticated', 'Session expired');
    }
  }

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
