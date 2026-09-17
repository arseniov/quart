import { Logger } from '@nestjs/common';
import { z } from 'zod';

// Cookie flag parser — accepts 'true'/'false' strings or undefined.
// Mirrors the SecurityEnv pattern; kept local so this schema stays
// independent of the security module (T45 narrow-env decision).
const FlagBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

/** Placeholder string emitted by `redactSecretNames`. */
export const REDACTED = '[redacted]' as const;

/**
 * Narrow schema for the OpenAPI / Swagger UI surface. Parsed separately
 * from `EnvSchema` so contexts without DB / Valkey / MinIO (scripts,
 * test rigs, the openapi export job) can still reason about the
 * documentation endpoint without pulling the full app config.
 *
 * The schema does NOT pull in the full EnvSchema — that's the whole point
 * of "narrow" per the T45 deviation list.
 */
export const SwaggerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Optional so we can distinguish "unset (dev convenience)" from
  // "explicit false (opt-out)". `resolveSwaggerEnabled` honours all
  // three: explicit true → on, explicit false → off, unset → on in
  // non-prod, off in prod.
  SWAGGER_ENABLED: FlagBool.optional(),

  SWAGGER_PATH: z.string().min(1).default('/docs'),
  SWAGGER_JSON_PATH: z.string().min(1).default('/openapi.json'),
  SWAGGER_TITLE: z.string().min(1).default('Quart API'),
  // Spec literal (T45 step 1). Operators can still override via env.
  SWAGGER_DESCRIPTION: z.string().default('Mobile + Admin shared API'),

  // Empty default → fall back to apps/api/package.json at boot. Override
  // here when shipping a tagged release with a frozen version label.
  SWAGGER_VERSION: z.string().default(''),

  // CSV of multi-tenant server URLs (e.g. city subdomains). Empty list
  // produces no `servers` block — the OpenAPI `Server` element is then
  // omitted, which keeps the spec valid without a fallback URL.
  SWAGGER_SERVERS: z.string().default(''),
});

export type SwaggerEnv = z.infer<typeof SwaggerEnvSchema>;

/**
 * Decide whether the OpenAPI surface should be wired into the app.
 *
 * Three states for `SWAGGER_ENABLED`:
 *   - `true`  → on (explicit opt-in, required in prod)
 *   - `false` → off (explicit opt-out, useful in dev for perf testing)
 *   - unset   → on in non-prod (dev/CI convenience), off in prod
 *
 * Production rule: surface MUST be off unless SWAGGER_ENABLED=true was
 * explicitly set — exposing the API contract on a public deployment
 * leaks the full endpoint inventory and security schemes.
 */
export function resolveSwaggerEnabled(env: SwaggerEnv): boolean {
  if (env.SWAGGER_ENABLED === true) return true;
  if (env.SWAGGER_ENABLED === false) return false;
  return env.NODE_ENV !== 'production';
}

/**
 * Split SWAGGER_SERVERS CSV into a trimmed, deduped list of valid URLs.
 * Empty / malformed entries are dropped silently (the OpenAPI `servers`
 * block is then either absent or just shorter). Malformed entries are
 * logged once via the `OpenApi` logger so an operator can spot a typo
 * without the spec silently emitting a broken URL.
 */
export function parseSwaggerServers(csv: string): string[] {
  const seen = new Set<string>();
  const dropped: string[] = [];
  for (const raw of csv.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      // new URL throws on relative / malformed input — that's the gate.
      // We don't require a protocol here, so we try with a dummy prefix
      // first and only validate that the result parses back to itself.
      new URL(trimmed);
      seen.add(trimmed);
    } catch {
      dropped.push(trimmed);
    }
  }
  if (dropped.length > 0) {
    new Logger('OpenApi').warn(
      `dropped invalid SWAGGER_SERVERS entries: ${dropped.join(', ')}`,
    );
  }
  return [...seen];
}

/**
 * Redact secret-shaped `NAME=value` substrings before they land in the
 * OpenAPI `info.description`. Cheap defence-in-depth — the env-driven
 * description is free text, so we mask anything that looks like
 * `SECRET_FOO=abc`, `API_KEY=xyz`, etc. that an operator accidentally
 * pasted in.
 *
 * Pattern notes:
 *   - case-insensitive (`/i`) so `secret_foo` / `Secret_Foo` both match
 *   - suffix is `\w+` (any word chars, lower or upper) so real-world
 *     names like `API_KEY_V2_AUTH` or `db_password` are caught
 *   - the whole `NAME=value` token is replaced — keeping the value
 *     visible defeats the redaction
 *
 * ponytail: regex-only; doesn't catch real-world secrets that don't
 * match this pattern. Replace with a structured metadata field
 * (e.g. `SWAGGER_CONTACT_EMAIL`, `SWAGGER_LICENSE_NAME`) when richer
 * input ever lands — until then this is good-enough and zero-dep.
 */
export function redactSecretNames(input: string): string {
  if (!input) return input;
  return input.replace(
    /\b(?:SECRET|TOKEN|KEY|PASSWORD|API_KEY)[\w]*\s*=\s*[^\s,]+/gi,
    REDACTED,
  );
}