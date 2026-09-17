import { buildCookieAttrs, type CookieAudience } from './cookie.policy.js';

/** Build Set-Cookie options for a fresh audience session. */
export function cookieSetOptions(audience: CookieAudience, maxAgeSeconds: number) {
  return { ...buildCookieAttrs(audience), maxAge: maxAgeSeconds };
}

/** Build Set-Cookie options that clear the audience cookie (maxAge=0). */
export function cookieClearOptions(audience: CookieAudience) {
  return { ...buildCookieAttrs(audience), maxAge: 0 };
}
