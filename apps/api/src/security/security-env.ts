import { z } from 'zod';

// Ponytail: byte-string helper covers '1mb', '512kb', '1024'. Add 'gb' / 'tb'
// if a future endpoint actually needs payloads that large (probably
// stream-upload via multipart instead, with its own per-route limit).
const BYTE_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

const SizeString = z
  .string()
  .regex(/^\d+(?:\.\d+)?(?:kb|mb|gb|b)?$/i, 'size must be a number with optional unit (kb|mb|gb|b)')
  .transform((s) => {
    const m = /^(\d+(?:\.\d+)?)(kb|mb|gb|b)?$/i.exec(s);
    if (!m) throw new Error(`invalid size: ${s}`);
    const n = Number(m[1]);
    const unit = (m[2] ?? 'b').toLowerCase();
    return Math.round(n * BYTE_UNITS[unit]!);
  });

// Cookie flag parser — accepts 'true'/'false' strings or undefined.
const FlagBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

/**
 * Narrow schema for HTTP hardening. Parsed separately from `EnvSchema` so
 * contexts without DB / Valkey / MinIO (workers, scripts, integration rigs)
 * can still surface their CORS / HSTS / body-size decisions without pulling
 * the full app config.
 */
export const SecurityEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // CSV of allowed origins. Empty = no CORS header (same-origin / server-to-server only).
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  CORS_ALLOW_CREDENTIALS: FlagBool.default(false),

  // Hard request body cap for JSON / form bodies. Multipart has its own per-route limit.
  // Default 12mb per the shared-api spec (T43) — covers most photo-metadata
  // JSON payloads without forcing every caller to set the flag.
  MAX_REQUEST_BODY_BYTES: SizeString.default('12mb'),

  // Optional JSON override for CSP directives. Parsed at boot — bad JSON
  // crashes the process (fail-fast on security config).
  HELMET_CSP_DIRECTIVES: z.string().default(''),
  // Escape hatch: re-enable `'unsafe-inline'` for `style-src`. Default
  // false because inline styles reopen the XSS surface. The admin SPA
  // ships per-file hashes via HELMET_CSP_DIRECTIVES instead.
  HELMET_ALLOW_INLINE_STYLES: FlagBool.default(false),

  HSTS_MAX_AGE_SECONDS: z.coerce.number().int().min(0).default(31_536_000),
  HSTS_INCLUDE_SUBDOMAINS: FlagBool.default(true),
  // HSTS preload opt-in. Submission to the browser preload list is a
  // separate irreversible decision — keep this off by default.
  HSTS_PRELOAD: FlagBool.default(false),

  // True only when fronted by Cloudflare Tunnel (or another trusted reverse proxy).
  TRUST_PROXY: FlagBool.default(false),

  // 32+ chars; signed-cookie secret. Dev fallback lets tests boot without an env file.
  COOKIE_SECRET: z.string().min(32).default('dev-cookie-secret-change-me-please-32b'),
});

export type SecurityEnv = z.infer<typeof SecurityEnvSchema>;

/**
 * Normalize an origin URL for case-insensitive comparison. Per RFC 6454,
 * scheme and host are case-insensitive; path/query are case-sensitive but
 * we don't compare them for origin matching. Malformed URLs fall back to
 * a lowercased string so the comparison still degrades gracefully.
 */
export function normalizeOrigin(o: string): string {
  try {
    const u = new URL(o);
    return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return o.toLowerCase();
  }
}

/**
 * Parse CSV origins into a normalized set. Each entry is validated as a
 * URL — bad entries throw at boot with the offending origin listed. Empty
 * CSV → empty set (signals "no CORS").
 */
export function parseAllowedOrigins(csv: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of csv.split(',')) {
    const v = raw.trim();
    if (!v) continue;
    try {
      // Validate: ensures the entry is a real URL, not e.g. a typo'd hostname.
      // new URL() throws on garbage like "not-a-url".
      new URL(v);
    } catch {
      throw new Error(`CORS_ALLOWED_ORIGINS contains invalid URL: ${v}`);
    }
    out.add(normalizeOrigin(v));
  }
  return out;
}

/**
 * Parse a JSON-encoded CSP directive override. Throws on bad JSON so the
 * operator notices at boot, not at first request.
 */
export function parseCspDirectives(json: string): Readonly<Record<string, ReadonlyArray<string>>> | undefined {
  const trimmed = json.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('HELMET_CSP_DIRECTIVES must be a JSON object of directive → string[]');
  }
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v === null) {
      out[k] = [];
      continue;
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      throw new Error(`HELMET_CSP_DIRECTIVES[${k}] must be a string[] or null`);
    }
    out[k] = v as ReadonlyArray<string>;
  }
  return out;
}
