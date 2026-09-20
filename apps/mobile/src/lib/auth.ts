// src/lib/auth.ts
// GH #46: BA session token storage. BA's /auth/sign-in/* + /auth/sign-up/email
// issue a session via Set-Cookie (`better-auth.session_token=<token>.<sig>`).
// The mobile persists the cookie value in MMKV (sync, no Keychain round-trip)
// and apiClient re-sends it as `Authorization: Bearer <token>`. BA's BaAuthGuard
// on the server resolves the session through BA's own getSession helper, so
// no client-side refresh dance — BA handles session lifetime server-side.
//
// Async signatures are kept for source compatibility with the pre-BA
// implementation; the MMKV reads/writes under the hood are sync.
import { MMKV } from 'react-native-mmkv';

const authMmkv = new MMKV({ id: 'quart.auth' });
export const BA_SESSION_TOKEN_KEY = 'baSessionToken';

export interface AuthTokens {
  baSessionToken: string;
}

export function loadTokens(): AuthTokens | null {
  const token = authMmkv.getString(BA_SESSION_TOKEN_KEY);
  return token ? { baSessionToken: token } : null;
}

export function saveTokens(tokens: AuthTokens): void {
  authMmkv.set(BA_SESSION_TOKEN_KEY, tokens.baSessionToken);
}

export function clearTokens(): void {
  authMmkv.delete(BA_SESSION_TOKEN_KEY);
}

// ponytail: keep the legacy Promise-returning wrappers — the call sites
//        already `await` these, and a sync-only rewrite would ripple
//        through every hook + screen.
export const loadTokensAsync = (): Promise<AuthTokens | null> => Promise.resolve(loadTokens());
export const saveTokensAsync = (tokens: AuthTokens): Promise<void> => Promise.resolve(saveTokens(tokens));
export const clearTokensAsync = (): Promise<void> => Promise.resolve(clearTokens());