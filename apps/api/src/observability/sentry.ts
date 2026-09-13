import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { z } from 'zod';

export const REDACTED = '[redacted]';
export const REDACTED_EMAIL = '[redacted-email]';
export const REDACTED_IP = '[redacted-ip]';
export const CYCLE_MARKER = '[cycle]';
export const DEPTH_CAPPED_MARKER = '[depth-capped]';

// ponytail: regex matches ASCII emails/IPs; missing IDN domains.
// Add when scope expands.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IP_RE =
  /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b|(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))/g;
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

// ponytail: depth 8 covers realistic request/exception trees without leaking
// pathological nesting into Sentry. Bump if real-world events get clipped.
const MAX_DEPTH = 8;

/**
 * Narrow env schema — main.ts / workers / one-off scripts parse ONLY the
 * Sentry keys they need, so contexts without DB / Valkey / MinIO envs can
 * still log to Sentry. Keeps the observability surface decoupled from app
 * config.
 */
export const SentryEnvSchema = z.object({
  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_PROFILING: z.string().optional(),
});
export type SentryEnv = z.infer<typeof SentryEnvSchema>;

/**
 * Initialize Sentry at process boot. Called from `main.ts` BEFORE
 * `NestFactory.create()` so bootstrap errors are captured.
 *
 * No-op when SENTRY_DSN is unset — keeps dev/test runs free of Sentry
 * outbound traffic. Profiling integration is gated behind
 * `SENTRY_PROFILING === 'true'`; default off.
 */
export function initSentry(env: SentryEnv): void {
  if (!env.SENTRY_DSN) return;
  const profiling = env.SENTRY_PROFILING === 'true';
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: 0.1,
    ...(profiling && {
      profilesSampleRate: 0.1,
      integrations: [nodeProfilingIntegration()],
    }),
    beforeSend: beforeSendForSentry,
  });
}

/**
 * `beforeSend` for Sentry. Strips EU PII from the event tree before it leaves
 * the process. Covers:
 *   - request.cookies, request.data (whole objects)
 *   - request.url, request.query_string (emails + IPs + fiscal code + VAT)
 *   - request.headers (authorization, cookie, set-cookie)
 *   - event.message, event.transaction, event.tags
 *   - exception.values[*].value, exception.values[*].stacktrace.frames[*].vars
 *   - breadcrumbs[*].message, breadcrumbs[*].data, extra, contexts
 *   - user (keep only id)
 *
 * Pure: clones the input before scrubbing. Sentry may replay or re-run the
 * hook; mutation would leak redaction state between runs.
 */
export function beforeSendForSentry(
  event: Sentry.ErrorEvent,
  _hint: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  if (!event) return event;

  // Cycle-aware clone preserves shared refs as shared refs in the copy, so
  // the scrubber can still flag them as `[cycle]`. JSON-clone would throw
  // on the cycle and force us to drop the event.
  const cloned = cloneEvent(event);
  if (cloned === null) return null;

  try {
    if (cloned.request) {
      delete cloned.request.cookies;
      delete cloned.request.data;
      if (cloned.request.url) cloned.request.url = scrubText(cloned.request.url);
      if (cloned.request.query_string !== undefined) {
        const qs =
          typeof cloned.request.query_string === 'string'
            ? scrubText(cloned.request.query_string)
            : scrub(cloned.request.query_string);
        cloned.request.query_string = qs as typeof cloned.request.query_string;
      }
      if (cloned.request.headers) {
        cloned.request.headers = scrubHeaders(cloned.request.headers);
      }
    }

    if (typeof cloned.message === 'string') cloned.message = scrubText(cloned.message);

    if (typeof cloned.transaction === 'string') {
      cloned.transaction = scrubText(cloned.transaction);
    }

    if (cloned.tags) {
      const scrubbed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cloned.tags)) {
        scrubbed[k] = typeof v === 'string' ? scrubText(v) : v;
      }
      cloned.tags = scrubbed as typeof cloned.tags;
    }

    if (cloned.exception?.values) {
      for (const ex of cloned.exception.values) {
        if (!ex) continue;
        if (typeof ex.value === 'string') ex.value = scrubText(ex.value);
        if (ex.stacktrace?.frames) {
          for (const frame of ex.stacktrace.frames) {
            if (frame && frame.vars) {
              frame.vars = scrub(frame.vars) as Record<string, unknown>;
            }
          }
        }
      }
    }

    if (cloned.breadcrumbs) {
      for (const b of cloned.breadcrumbs) {
        if (!b) continue;
        if (typeof b.message === 'string') b.message = scrubText(b.message);
        if (b.data) b.data = scrub(b.data) as Record<string, unknown>;
      }
    }

    if (cloned.extra) cloned.extra = scrub(cloned.extra) as Record<string, unknown>;
    if (cloned.contexts) {
      cloned.contexts = scrub(cloned.contexts) as typeof cloned.contexts;
    }

    if (cloned.user) cloned.user = { id: cloned.user.id } as Sentry.User;

    return cloned;
  } catch {
    // Fail-closed: if scrubbing throws, drop the event rather than ship
    // unredacted PII.
    return null;
  }
}

function cloneEvent<T>(v: T): T | null {
  try {
    return deepClone(v) as T;
  } catch {
    return null;
  }
}

function deepClone(v: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (v == null || typeof v !== 'object') return v;
  if (seen.has(v as object)) return seen.get(v as object);
  if (Array.isArray(v)) {
    const arr: unknown[] = [];
    seen.set(v as object, arr);
    for (const item of v) arr.push(deepClone(item, seen));
    return arr;
  }
  const out: Record<string, unknown> = {};
  seen.set(v as object, out);
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = deepClone(val, seen);
  }
  return out;
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

// Top-level scrub — fresh WeakSet per subtree so sibling branches aren't
// false-flagged as cycles.
function scrub(v: unknown): unknown {
  return scrubValue(v, new WeakSet<object>(), 0);
}

function scrubValue(v: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return scrubText(v);
  if (typeof v !== 'object') return v;
  if (depth >= MAX_DEPTH) return DEPTH_CAPPED_MARKER;
  if (seen.has(v as object)) return CYCLE_MARKER;
  seen.add(v as object);
  try {
    if (Array.isArray(v)) {
      return v.map((item) => scrubValue(item, seen, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = isPIIKey(k) ? REDACTED : scrubValue(val, seen, depth + 1);
    }
    return out;
  } finally {
    seen.delete(v as object);
  }
}
