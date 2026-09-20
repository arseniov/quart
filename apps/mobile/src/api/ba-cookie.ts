// src/api/ba-cookie.ts
// Extract the BA session cookie value from a Set-Cookie response header.
// We only care about the value — the server-side BaAuthGuard accepts the
// whole signed value (`<token>.<sig>`) as the Bearer credential.
//
// BA emits one of two cookie names depending on the configured baseURL:
//   - `__Secure-better-auth.session_token` — production HTTPS
//     (`__Secure-` prefix is required by browsers when the cookie is `Secure`)
//   - `better-auth.session_token`         — dev / staging over HTTP
// We check the secure-prefixed name first because production always wins on
// real traffic. Without the prefix check, every auth flow in production
// would return null → `auth.no_session` → user forced to re-auth on the
// very next request after sign-in.
const BA_SESSION_COOKIES = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token',
] as const;

export function extractBaSessionToken(headers: Headers): string | null {
  // fetch's Headers#getSetCookie returns every Set-Cookie line as an array
  // (one entry per Set-Cookie header); combine before parsing so cookies
  // set across multiple lines don't get lost.
  const raw = headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const first = line.split(';', 1)[0]?.trim() ?? '';
    for (const name of BA_SESSION_COOKIES) {
      if (first.startsWith(`${name}=`)) {
        return first.slice(name.length + 1);
      }
    }
  }
  return null;
}