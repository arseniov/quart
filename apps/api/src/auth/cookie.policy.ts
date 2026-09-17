// __Host- prefix required: forces Secure, Path=/, and no Domain attribute (locks cookies to exact host, no subdomain takeover).
export type CookieAudience = 'mobile' | 'admin';

export const mobileApiCookieName = () => '__Host-quart-api-session' as const;
export const adminCookieName = () => '__Host-quart-admin-session' as const;

export interface CookieAttrs {
  httpOnly: true;
  secure: true;
  path: '/';
  sameSite: 'lax' | 'strict';
}

export function buildCookieAttrs(audience: CookieAudience): CookieAttrs {
  return {
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: audience === 'admin' ? 'strict' : 'lax',
  };
}

export function cookieNameFor(audience: CookieAudience): string {
  return audience === 'admin' ? adminCookieName() : mobileApiCookieName();
}
