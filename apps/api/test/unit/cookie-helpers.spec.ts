import { describe, it, expect } from 'vitest';

import { cookieSetOptions, cookieClearOptions } from '../../src/auth/cookie-helpers.js';

describe('cookie helpers', () => {
  it('mobile set options match Lax policy and echo maxAge', () => {
    const o = cookieSetOptions('mobile', 3600);
    expect(o.sameSite).toBe('lax');
    expect(o.maxAge).toBe(3600);
    expect(o.httpOnly).toBe(true);
    expect(o.secure).toBe(true);
    expect(o.path).toBe('/');
  });

  it('admin set options match Strict policy and echo maxAge', () => {
    const o = cookieSetOptions('admin', 60);
    expect(o.sameSite).toBe('strict');
    expect(o.maxAge).toBe(60);
    expect(o.httpOnly).toBe(true);
    expect(o.secure).toBe(true);
    expect(o.path).toBe('/');
  });

  it('mobile clear options set maxAge=0 with Lax policy', () => {
    const o = cookieClearOptions('mobile');
    expect(o.maxAge).toBe(0);
    expect(o.sameSite).toBe('lax');
  });

  it('admin clear options set maxAge=0 with Strict policy', () => {
    const o = cookieClearOptions('admin');
    expect(o.maxAge).toBe(0);
    expect(o.sameSite).toBe('strict');
  });

  it('set and clear share shape except for maxAge', () => {
    const set = cookieSetOptions('mobile', 3600);
    const clear = cookieClearOptions('mobile');
    expect({ ...set, maxAge: 0 }).toEqual(clear);
    const setA = cookieSetOptions('admin', 60);
    const clearA = cookieClearOptions('admin');
    expect({ ...setA, maxAge: 0 }).toEqual(clearA);
  });

  it('echoes arbitrary maxAge values (deterministic passthrough)', () => {
    expect(cookieSetOptions('mobile', 0).maxAge).toBe(0);
    expect(cookieSetOptions('admin', 86400).maxAge).toBe(86400);
    expect(cookieSetOptions('mobile', 1).maxAge).toBe(1);
  });

  it('result objects are independent (no shared refs from buildCookieAttrs)', () => {
    const a = cookieSetOptions('mobile', 100);
    const b = cookieSetOptions('mobile', 200);
    expect(a).not.toBe(b);
    expect(a.maxAge).toBe(100);
    expect(b.maxAge).toBe(200);
  });

  it('delegates sameSite per audience (mobile=lax, admin=strict)', () => {
    expect(cookieSetOptions('mobile', 3600).sameSite).toBe('lax');
    expect(cookieSetOptions('admin', 3600).sameSite).toBe('strict');
    expect(cookieClearOptions('mobile').sameSite).toBe('lax');
    expect(cookieClearOptions('admin').sameSite).toBe('strict');
  });

  it('all four variants set httpOnly/secure/path identically', () => {
    for (const opts of [
      cookieSetOptions('mobile', 3600),
      cookieSetOptions('admin', 60),
      cookieClearOptions('mobile'),
      cookieClearOptions('admin'),
    ]) {
      expect(opts.httpOnly).toBe(true);
      expect(opts.secure).toBe(true);
      expect(opts.path).toBe('/');
    }
  });

  it('returns a plain object with exactly the expected keys', () => {
    const keys = Object.keys(cookieSetOptions('mobile', 3600)).sort();
    expect(keys).toEqual(['httpOnly', 'maxAge', 'path', 'sameSite', 'secure']);
    const clearKeys = Object.keys(cookieClearOptions('admin')).sort();
    expect(clearKeys).toEqual(['httpOnly', 'maxAge', 'path', 'sameSite', 'secure']);
  });

  it('clear options carry no other expiry hint besides maxAge=0', () => {
    const o = cookieClearOptions('mobile');
    expect(o.maxAge).toBe(0);
    expect(Object.keys(o)).not.toContain('expires');
  });
});
