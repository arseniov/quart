// apps/api/src/auth/ba-session-mint.ts
// GH #48: programmatic BA session mint for flows that don't go through a
// BA sign-in endpoint. The phone-OTP verify handler uses this after a
// successful Twilio match + Quart user lookup — we look up the matching
// BA user by email (BA `user.email` is the canonical join key between the
// two systems, see ba-audit.hook.ts:189), create a BA session row via the
// internal adapter, and serialize a Set-Cookie header the caller can
// forward on its response.
//
// Why not `instance.api.signInEmail({ body: { email, password } })`? It
// would require a password we don't have for phone-only sign-in (BA's
// `phoneNumber()` plugin's `signInPhoneNumber` endpoint also requires a
// password). The session-create path below bypasses BA's password check
// entirely — it's the same path BA's own endpoints take AFTER the
// credential check succeeds (see api.cjs:signInEmail → `internalAdapter
// .createSession(...)` → `setSessionCookie`).
//
// Limitation: a phone-only Quart user with NO BA `user` row (no email ever
// provided) returns `null` from this helper. The mobile falls back to
// `auth.no_session` and re-signs in via email or social — same UX as the
// pre-#48 state.

import { createHmac } from 'node:crypto';

import type { AuthService } from './auth.service.js';

interface CookieConfigLike {
  name: string;
  options: Record<string, unknown>;
}

/**
 * Build the Set-Cookie value for a freshly-created BA session.
 *
 * The cookie format mirrors what `setSessionCookie` (better-auth) emits:
 *   - name: `<authCookies.sessionToken.name>` (typically
 *     `better-auth.session_token`, or `__Secure-better-auth.session_token`
 *     when the configured baseURL is HTTPS).
 *   - value: `<token>.<base64-hmac-sha256(token, secret)>` — the
 *     `token.signature` shape `getSignedCookie` verifies on every
 *     request (see better-call/cookies.mjs:38-48).
 *   - attrs: `authCookies.sessionToken.options` (httpOnly, sameSite=lax,
 *     path=/, secure-when-HTTPS) plus `maxAge=sessionConfig.expiresIn`.
 */
function serializeSessionCookie(
  token: string,
  secret: string,
  cookieConfig: CookieConfigLike,
  expiresInSeconds: number,
): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  // BA's `setSessionCookie` wraps the signed value in `encodeURIComponent`
  // in `serializeSigned` (better-call/cookies.mjs), then decodes URI before
  // splitting. We mirror that here so the emitted Set-Cookie matches BA's
  // byte-for-byte output for the value. For nanoid-32 alphanumeric tokens
  // the encode is a no-op, but the parity holds for any token shape.
  const value = encodeURIComponent(`${token}.${signature}`);
  const opts: Record<string, unknown> = { ...cookieConfig.options, maxAge: expiresInSeconds };
  const parts = [`${cookieConfig.name}=${value}`];
  if (typeof opts['maxAge'] === 'number') parts.push(`Max-Age=${opts['maxAge']}`);
  if (typeof opts['path'] === 'string') parts.push(`Path=${opts['path']}`);
  // The Set-Cookie emitted here is case-insensitively equivalent to what
  // BA's `setSessionCookie` produces for the same `authCookies.sessionToken`.
  // Attribute order differs (this emits `Max-Age, Path, SameSite, HttpOnly,
  // Secure` vs BA's `Max-Age, Domain, Path, Expires, HttpOnly, Secure,
  // SameSite`), but RFC 6265 treats attribute order as irrelevant — all
  // compliant cookie parsers yield the same parsed cookie. The sameSite
  // capitalisation (`lax` → `Lax`) matches BA's output, which keeps existing
  // cookie-attribute comparators (e.g. express-session's signed-cookie
  // verifier) happy.
  if (typeof opts['sameSite'] === 'string') {
    const sameSite = opts['sameSite'];
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  }
  if (opts['httpOnly']) parts.push('HttpOnly');
  if (opts['secure']) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Mint a BA session for the user identified by email and serialize the
 * Set-Cookie value. Returns `null` when:
 *   - the email is null/empty (phone-only Quart user with no BA account)
 *   - the BA `user` row is missing (orphan Quart user)
 *   - `internalAdapter.createSession` returns null (DB hiccup)
 *
 * The `request` is forwarded so BA populates `session.ipAddress` +
 * `session.userAgent` from the inbound headers (same fields BA's own
 * sign-in endpoints read).
 */
export async function mintBaSessionCookie(
  authService: AuthService,
  email: string | null,
  request: { headers: Headers | Record<string, string | string[] | undefined> },
): Promise<string | null> {
  if (!email) return null;

  // ponytail: GH #49 upgrade contract — `better-auth` is pinned to `~1.0.x`
  // in apps/api/package.json so the next 1.0.x patch auto-flows but any
  // minor (1.1+) or major bump needs manual review. The fields below
  // come from BA's runtime `$context` (added by api.cjs at runtime, NOT
  // in BA's TS declarations). Verify against the GH #49 integration
  // test (test/integration/ba-session-mint.spec.ts) before bumping.
  //
  //   $context.internalAdapter.findUserByEmail(email: string)
  //     → Promise<{ user: { id: string; email: string } } | null>
  //     Looks up BA's `user` table. Returns the user row (only `id` +
  //     `email` are read here) or null if no row matches. The Kysely
  //     adapter implementation is in auth.adapter.ts.
  //
  //   $context.internalAdapter.createSession(userId: string, headers: Headers)
  //     → Promise<{ token: string } | null>
  //     Writes a row to BA's `session` table and emits a nanoid-32
  //     `token`. Reads `ipAddress` + `userAgent` from `headers` (via
  //     Headers.get) the same way BA's own /sign-in/email endpoint
  //     populates them — we just pass the inbound request headers
  //     straight through. Returns null on a DB hiccup; callers must
  //     treat null as "no session minted" and fall back.
  //
  //   $context.secret: string
  //     The `BETTER_AUTH_SECRET` env value. Used as the HMAC-SHA256 key
  //     in `serializeSessionCookie` so the signed cookie matches what
  //     `getSessionCookie` will verify on the next request.
  //
  //   $context.authCookies.sessionToken: { name: string; options: ... }
  //     The cookie name + attrs BA emits. `name` typically
  //     `better-auth.session_token` (or `__Secure-better-auth.session_token`
  //     when `BETTER_AUTH_URL` is HTTPS). `options` carries httpOnly,
  //     sameSite, path, secure — we forward them through to the
  //     Set-Cookie string so the emitted attrs match BA's `setSessionCookie`
  //     byte-for-byte (modulo order, which RFC 6265 says is irrelevant).
  //
  //   $context.sessionConfig.expiresIn: number (seconds)
  //     Session lifetime. We emit it as `Max-Age=<seconds>` so the
  //     browser + BA's `getSessionCookie` agree on expiry.
  //
  // If BA 1.1+ renames any of these (e.g. drops `$context` from
  // endpoint objects, changes `internalAdapter.createSession` to
  // return `{ token, expiresAt }`, or moves `authCookies.sessionToken`
  // under a different key), this cast breaks the typecheck AND the
  // GH #49 integration test fails on first run. That's the point.
  //
  // `$context` is added by BA at runtime on every endpoint object
  // (see better-auth/api.cjs `n={...{signInSocial:De,signInEmail:Ce}}`)
  // but is NOT in BA 1.0.20's TypeScript declarations. Cast through
  // `unknown` to access it without pulling in `as any` casts everywhere
  // downstream.
  const getSessionEndpoint = authService.instance.api.getSession as unknown as {
    $context: Promise<{
      secret: string;
      authCookies: { sessionToken: CookieConfigLike };
      sessionConfig: { expiresIn: number };
      internalAdapter: {
        findUserByEmail: (
          email: string,
        ) => Promise<{ user: { id: string; email: string } } | null>;
        createSession: (userId: string, headers: Headers) => Promise<{ token: string } | null>;
      };
    }>;
  };
  const ctx = await getSessionEndpoint.$context;

  const baUserRow = await ctx.internalAdapter.findUserByEmail(email);
  if (!baUserRow?.user) return null;

  // Convert plain-record headers to a Headers instance for BA's adapter.
  // BA's `createSession(userId, request, dontRememberMe)` reads IP/UA
  // from `request.headers` when request is a Web Request; a plain Headers
  // object is enough for the IP/UA extraction (it reads via .get()).
  const headers =
    request.headers instanceof Headers
      ? request.headers
      : new Headers(
          Object.entries(request.headers).flatMap(([k, v]) =>
            Array.isArray(v) ? v.map((vv) => [k, vv]) : v !== undefined ? [[k, v]] : [],
          ),
        );

  const session = await ctx.internalAdapter.createSession(baUserRow.user.id, headers);
  if (!session) return null;

  return serializeSessionCookie(
    session.token,
    ctx.secret,
    ctx.authCookies.sessionToken,
    ctx.sessionConfig.expiresIn,
  );
}