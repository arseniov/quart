/**
 * Per-app Content-Security-Policy strings.
 *
 * Two callers:
 *   - Mobile SPA (served from `quart-app.com`): no inline scripts, no
 *     Sentry browser replay bundle. Strict.
 *   - Admin SPA (served from `admin.quart-app.com`): inline scripts
 *     allowed for the Sentry browser-replay loader hosted on jsDelivr,
 *     plus the `*.sentry.io` ingest endpoints in `connect-src`.
 *
 * Returned as ready-to-emit header strings — `@fastify/helmet` is
 * registered with `contentSecurityPolicy: false` on the admin adapter
 * so we own the header end-to-end (no merging with helmet's defaults).
 *
 * Wire from a Fastify hook (see helmet.ts / `onSend`) once per app so the
 * right string is selected by hostname.
 */

const PUBLIC_ASSETS = 'https://quart-public-assets.s3.eu-central-1.hetzner.com';
const API_ORIGIN = 'https://api.quart.app';
const SENTRY_INGEST = 'https://*.sentry.io';
const JSDELIVR = 'https://cdn.jsdelivr.net';

export function cspForAdmin(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${JSDELIVR}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${PUBLIC_ASSETS}`,
    `connect-src 'self' ${API_ORIGIN} ${SENTRY_INGEST}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ');
}

export function cspForMobile(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${PUBLIC_ASSETS}`,
    `connect-src 'self' ${API_ORIGIN}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; ');
}