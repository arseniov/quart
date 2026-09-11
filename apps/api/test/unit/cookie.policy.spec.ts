import { describe, it, expect } from 'vitest';

import { mobileApiCookieName, adminCookieName, buildCookieAttrs, cookieNameFor } from '../../src/auth/cookie.policy.js';

describe('cookie.policy', () => {
  it('returns distinct names for mobile vs admin (no shared namespace)', () => {
    expect(mobileApiCookieName()).toBe('__Host-quart-api-session');
    expect(adminCookieName()).toBe('__Host-quart-admin-session');
    expect(mobileApiCookieName()).not.toBe(adminCookieName());
  });

  it('mobile uses SameSite=Lax, admin uses SameSite=Strict', () => {
    const m = buildCookieAttrs('mobile');
    const a = buildCookieAttrs('admin');
    expect(m.sameSite).toBe('lax');
    expect(a.sameSite).toBe('strict');
    expect(m.httpOnly).toBe(true);
    expect(m.secure).toBe(true);
    expect(m.path).toBe('/');
    expect(cookieNameFor('mobile')).toBe('__Host-quart-api-session');
    expect(cookieNameFor('admin')).toBe('__Host-quart-admin-session');
  });
});
