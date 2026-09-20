// src/api/__tests__/ba-cookie.test.ts
// GH #48: the BA session cookie emitted by production servers is prefixed
// with `__Secure-` (because `BETTER_AUTH_URL` is HTTPS). The mobile
// extractor must read either name; without the prefix check, every auth
// flow in production throws `auth.no_session` immediately after sign-in.
import { extractBaSessionToken } from '@/api/ba-cookie';

function withSetCookie(cookie: string, extra: string[] = []): Headers {
  const h = new Headers();
  h.append('set-cookie', cookie);
  for (const c of extra) h.append('set-cookie', c);
  return h;
}

describe('extractBaSessionToken', () => {
  it('parses the plain (dev/HTTP) BA session cookie', () => {
    const headers = withSetCookie(
      'better-auth.session_token=ba-token.abc; HttpOnly; Path=/; SameSite=Lax',
    );
    expect(extractBaSessionToken(headers)).toBe('ba-token.abc');
  });

  it('parses the __Secure- prefixed (production HTTPS) BA session cookie', () => {
    const headers = withSetCookie(
      '__Secure-better-auth.session_token=ba-prod-tok.xyz; HttpOnly; Path=/; Secure; SameSite=Lax',
    );
    expect(extractBaSessionToken(headers)).toBe('ba-prod-tok.xyz');
  });

  it('returns null when no BA session cookie is present', () => {
    const headers = withSetCookie(
      'unrelated=foo; HttpOnly',
      ['session=other; Path=/'],
    );
    expect(extractBaSessionToken(headers)).toBeNull();
  });

  it('returns the __Secure- cookie value when both names are present (production path)', () => {
    const headers = withSetCookie(
      '__Secure-better-auth.session_token=ba-secure.win; Secure; HttpOnly; Path=/; SameSite=Lax',
      ['better-auth.session_token=ba-plain.lose; HttpOnly; Path=/; SameSite=Lax'],
    );
    expect(extractBaSessionToken(headers)).toBe('ba-secure.win');
  });

  it('extracts from the first matching Set-Cookie line', () => {
    const headers = withSetCookie(
      'tracking=ad-id; Path=/',
      ['__Secure-better-auth.session_token=ba-tok.sig; Secure; HttpOnly; Path=/'],
    );
    expect(extractBaSessionToken(headers)).toBe('ba-tok.sig');
  });
});
