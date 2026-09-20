// src/api/ba-cookie.ts
// Extract the BA session cookie value from a Set-Cookie response header.
// BA's default session cookie is `better-auth.session_token=<token>.<sig>`
// (HttpOnly, SameSite=Lax). We only care about the value — the server-side
// BaAuthGuard accepts the whole signed value as the Bearer credential.
const BA_SESSION_COOKIE = 'better-auth.session_token';

export function extractBaSessionToken(headers: Headers): string | null {
  // fetch's Headers#getSetCookie returns every Set-Cookie line as an array
  // (one entry per Set-Cookie header); combine before parsing so cookies
  // set across multiple lines don't get lost.
  const raw = headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const first = line.split(';', 1)[0]?.trim() ?? '';
    if (first.startsWith(`${BA_SESSION_COOKIE}=`)) {
      return first.slice(BA_SESSION_COOKIE.length + 1);
    }
  }
  return null;
}