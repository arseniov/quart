/**
 * Per-app Content-Security-Policy strings.
 *
 * Two callers:
 *   - Mobile SPA (served from `quart-app.com`): no inline scripts, no
 *     Sentry browser replay bundle. Strict. Allows Stripe iframes for
 *     Payment Element / 3DS challenge / Apple Pay sheet.
 *   - Admin SPA (served from `admin.quart-app.com`): external Sentry
 *     browser-replay bundle hosted on jsDelivr (no inline scripts), plus
 *     `*.sentry.io` ingest endpoints in `connect-src`.
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
const STRIPE_FRAMES = 'https://js.stripe.com https://hooks.stripe.com';

/**
 * Directives shared by every app. Order is not meaningful to browsers
 * but kept stable so emitted headers diff cleanly across changes.
 */
const SHARED_DIRECTIVES = [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  'upgrade-insecure-requests',
] as const;

export function cspForAdmin(): string {
  return [
    ...SHARED_DIRECTIVES,
    `script-src 'self' ${JSDELIVR}`,
    "style-src 'self'",
    `img-src 'self' data: ${PUBLIC_ASSETS}`,
    `connect-src 'self' ${API_ORIGIN} ${SENTRY_INGEST}`,
  ].join('; ');
}

export function cspForMobile(): string {
  return [
    ...SHARED_DIRECTIVES,
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${PUBLIC_ASSETS}`,
    `connect-src 'self' ${API_ORIGIN}`,
    `frame-src ${STRIPE_FRAMES}`,
  ].join('; ');
}
