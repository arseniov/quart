// src/lib/auth.ts
import { createAuthClient } from 'better-auth/react';
import { secureGet, secureSet, secureDelete, SECURE_KEYS } from './secure-store';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ponytail: better-auth/react is web-flavored (uses fetch + redirect). Kept here as a
// typed surface for future login/signup methods, but tokens are loaded directly via
// secure-store so we don't depend on the react adapter at runtime.
export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
});

export async function loadTokens(): Promise<AuthTokens | null> {
  const [access, refresh] = await Promise.all([
    secureGet(SECURE_KEYS.accessToken),
    secureGet(SECURE_KEYS.refreshToken),
  ]);
  if (!access || !refresh) return null;
  return { accessToken: access, refreshToken: refresh };
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await Promise.all([
    secureSet(SECURE_KEYS.accessToken, tokens.accessToken),
    secureSet(SECURE_KEYS.refreshToken, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    secureDelete(SECURE_KEYS.accessToken),
    secureDelete(SECURE_KEYS.refreshToken),
  ]);
}
