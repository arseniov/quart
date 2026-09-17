import type { FastifyHelmetOptions } from '@fastify/helmet';

import { type SecurityEnv, parseCspDirectives } from './security-env.js';

/**
 * Default-deny CSP. Production deployments override per-app via
 * `HELMET_CSP_DIRECTIVES` (JSON) — e.g. the admin UI needs `'unsafe-inline'`
 * hashes for inline styles, mobile clients don't.
 *
 * Inline styles are off by default. Some legacy admin UIs can't ship
 * without them; set `HELMET_ALLOW_INLINE_STYLES=true` to re-enable. The
 * admin SPA computes per-file hashes and ships them via
 * `HELMET_CSP_DIRECTIVES` instead — that's the correct path.
 *
 *   - `connect-src 'self'`: SSE / WebSocket stay same-origin (CORS layer
 *     blocks cross-origin upgrades if we ever need them).
 *   - `media-src 'self'`: explicit directive — without it browsers fall
 *     back to `default-src 'self'`, which is what we want, but listing it
 *     kills the surprise if `default-src` is ever loosened.
 *   - `frame-ancestors 'none'`: defense-in-depth alongside `X-Frame-Options`.
 *   - `object-src 'none'`, `base-uri 'self'`: kill legacy attack surfaces.
 *   - `upgrade-insecure-requests`: free win behind TLS.
 */
const DEFAULT_CSP_DIRECTIVES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'"],
  'connect-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

/**
 * Convert readonly-record CSP into the mutable `string[] | null` shape
 * helmet expects. Each directive value is spread into a fresh array.
 */
function toHelmetDirectives(
  src: Readonly<Record<string, ReadonlyArray<string>>>,
): Record<string, string[] | null> {
  const out: Record<string, string[] | null> = {};
  for (const [k, v] of Object.entries(src)) out[k] = [...v];
  return out;
}

export interface HelmetBuildOptions {
  /** Parsed security env. Production / dev / test is read off `NODE_ENV`. */
  readonly env: SecurityEnv;
}

/**
 * Build the `@fastify/helmet` plugin options for a given security env.
 *
 * HSTS is gated on `NODE_ENV === 'production'`. Dev runs over HTTP and a
 * `Strict-Transport-Security` header would either be ignored by the browser
 * (good) or persist into the user's cache for 365 days (bad). Skip in
 * non-prod.
 */
export function buildHelmetOptions({ env }: HelmetBuildOptions): FastifyHelmetOptions {
  const override = parseCspDirectives(env.HELMET_CSP_DIRECTIVES);
  let directives = override
    ? toHelmetDirectives(override)
    : toHelmetDirectives(DEFAULT_CSP_DIRECTIVES);

  // Escape hatch: allow inline styles when `HELMET_ALLOW_INLINE_STYLES=true`.
  // Default-off because `'unsafe-inline'` re-opens the XSS surface that
  // nonces/hashes are designed to close. The admin UI should ship hashes
  // via `HELMET_CSP_DIRECTIVES` rather than relying on this flag.
  if (env.HELMET_ALLOW_INLINE_STYLES) {
    directives = { ...directives, 'style-src': ["'self'", "'unsafe-inline'"] };
  }

  const isProd = env.NODE_ENV === 'production';

  return {
    // CSP defaults off — we set our own default-deny policy below. If a
    // deployment wants helmet's `useDefaults`, pass HELMET_CSP_DIRECTIVES
    // explicitly and the override path runs.
    contentSecurityPolicy: {
      useDefaults: false,
      directives,
    },
    // Defense-in-depth alongside `frame-ancestors 'none'` in CSP — older
    // browsers ignore CSP frame-ancestors.
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // `x-content-type-options: nosniff` is on by default; keep it.
    // HSTS only in prod (dev uses HTTP).
    ...(isProd && {
      strictTransportSecurity: {
        maxAge: env.HSTS_MAX_AGE_SECONDS,
        includeSubDomains: env.HSTS_INCLUDE_SUBDOMAINS,
        preload: env.HSTS_PRELOAD,
      },
    }),
  };
}

/**
 * Default CSP directives — exported for tests / docs.
 */
export const DEFAULT_CSP = DEFAULT_CSP_DIRECTIVES;
