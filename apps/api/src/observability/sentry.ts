import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

import type { Env } from '../config/schema.js';

export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted-email]';
export const REDACTED_IP = '[redacted-ip]';

// ponytail: regex matches ASCII emails/IPs; missing IDN domains, IPv6, and
// non-Italian fiscal codes. Add when scope expands.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// Italian codice fiscale: 6 letters + 2 digits + 1 letter + 2 digits + 1 letter + 3 digits + 1 letter.
const CF_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi;
// Italian partita IVA: 11 digits (heuristic — could collide with other 11-digit ids).
const VAT_RE = /\b\d{11}\b/g;

// PII key set — matched case-insensitively. Add to it when new auth or PII fields appear.
const PII_KEYS: ReadonlySet<string> = new Set([
  'password',
  'new_password',
  'totp_code',
  'token',
  'email',
  'phone',
  'ip',
  'authorization',
  'cookie',
  'set-cookie',
  'set_cookie',
  'jwt',
  'access_token',
  'refresh_token',
  'secret',
  'api_key',
  'apikey',
  'ssn',
  'fiscal_code',
  'codice_fiscale',
  'vat',
  'partita_iva',
  'bearer',
  'private_key',
  'client_secret',
]);

const isPIIKey = (k: string): boolean => PII_KEYS.has(k.toLowerCase());

/**
 * Initialize Sentry at process boot. Called from `main.ts` BEFORE
 * `NestFactory.create()` so bootstrap errors are captured.
 *
 * No-op when SENTRY_DSN is unset — keeps dev/test runs free of Sentry
 * outbound traffic.
 */
export function initSentry(env: Pick<Env, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT'>): void {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    beforeSend: beforeSendForSentry as never,
  });
}

/**
 * `beforeSend` for Sentry. Strips EU PII from the event tree before it leaves
 * the process. Covers:
 *   - request.cookies, request.data (whole objects)
 *   - request.url, request.query_string (emails + IPs + fiscal code + VAT)
 *   - request.headers (authorization, cookie, set-cookie)
 *   - breadcrumbs[*].data, extra, contexts (recursive key scrub + value regex)
 *   - user (keep only id)
 */
// Sentry's BeforeSendHook expects an ErrorEvent; we accept the broader Event
// type and return the same shape (mutated) so the contract is satisfied at runtime.
export function beforeSendForSentry(event: Sentry.Event): Sentry.Event | null {
  if (!event) return event;

  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) event.request.url = scrubText(event.request.url);
    if (event.request.query_string !== undefined) {
      event.request.query_string = scrubText(String(event.request.query_string));
    }
    if (event.request.headers) {
      event.request.headers = scrubHeaders(event.request.headers);
    }
  }

  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (b.data) b.data = scrubValue(b.data) as Record<string, unknown>;
    }
  }

  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubValue(event.contexts) as unknown as typeof event.contexts;

  if (event.user) event.user = { id: event.user.id } as Sentry.User;

  return event;
}

function scrubHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = isPIIKey(k) ? REDACTED : Array.isArray(v) ? v.join(', ') : (v ?? '');
  }
  return out;
}

function scrubText(s: string): string {
  return s
    .replace(EMAIL_RE, REDACTED_EMAIL)
    .replace(IP_RE, REDACTED_IP)
    .replace(CF_RE, REDACTED)
    .replace(VAT_RE, REDACTED);
}

function scrubValue(v: unknown): unknown {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(scrubValue);
  if (typeof v === 'string') return scrubText(v);
  if (typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = isPIIKey(k) ? REDACTED : scrubValue(val);
  }
  return out;
}