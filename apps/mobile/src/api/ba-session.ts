// src/api/ba-session.ts
// Helper for the post-auth BA session persist + device-register sequence
// shared by every sign-in / sign-up / phone-verify / social-login hook
// (GH #50). Keeps the extract→throw→saveTokens→register-device block out
// of each caller so the pattern lives in one place. Kept separate from
// ba-cookie.ts because the helper also pulls in saveTokens + the
// register-device mutation — past ba-cookie's pure-parse scope.
import { extractBaSessionToken } from '@/api/ba-cookie';
import { ApiError } from '@/api/client';
import { NotificationsPermissionError } from '@/api/hooks/useRegisterDevice';
import { saveTokens } from '@/lib/auth';

export type BaSessionSource = 'login' | 'signup' | 'social' | 'phone_verify';

/**
 * Persist the BA session cookie returned by an auth endpoint and fire
 * the post-auth device-register call. Throws `auth.no_session` if the
 * response omitted the cookie (the server should always set one for
 * valid auth, so a missing cookie is a server bug worth surfacing).
 * Swallows `NotificationsPermissionError` from device-register — user
 * denying notifications must not fail login.
 */
export async function persistBaSessionFromResponse(
  headers: Headers,
  source: BaSessionSource,
  register: { mutateAsync: () => Promise<unknown> },
): Promise<void> {
  const baSessionToken = extractBaSessionToken(headers);
  if (!baSessionToken) {
    throw new ApiError(500, 'auth.no_session', `no session cookie in ${source} response`);
  }
  saveTokens({ baSessionToken });
  try {
    await register.mutateAsync();
  } catch (e) {
    if (!(e instanceof NotificationsPermissionError)) throw e;
  }
}
