// src/lib/auth.ts
import { secureGet, secureSet, secureDelete, SECURE_KEYS } from './secure-store';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

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