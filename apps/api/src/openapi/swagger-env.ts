import { z } from 'zod';

// Cookie flag parser — accepts 'true'/'false' strings or undefined.
// Mirrors the SecurityEnv pattern; kept local so this schema stays
// independent of the security module (T45 narrow-env decision).
const FlagBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true'));

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

  // Opt-in: defaults false so a stray prod deploy doesn't leak the API
  // surface. `resolveSwaggerEnabled` flips it on automatically when
  // NODE_ENV !== 'production' so devs / CI don't have to remember to
  // set the flag (see deviation #2).
  SWAGGER_ENABLED: FlagBool.default(false),

  SWAGGER_PATH: z.string().min(1).default('/docs'),
  SWAGGER_JSON_PATH: z.string().min(1).default('/openapi.json'),
  SWAGGER_TITLE: z.string().min(1).default('Quart API'),
  SWAGGER_DESCRIPTION: z.string().default(''),

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
 * Default OFF in production (deviation #2): the explicit flag wins, but
 * if it's left at the false default we still flip it on in any
 * non-production environment so local dev / CI smoke flows don't need
 * to remember to set it.
 *
 * Production rule: surface MUST be off unless SWAGGER_ENABLED=true was
 * explicitly set — exposing the API contract on a public deployment
 * leaks the full endpoint inventory and security schemes.
 */
export function resolveSwaggerEnabled(env: SwaggerEnv): boolean {
  if (env.SWAGGER_ENABLED) return true;
  return env.NODE_ENV !== 'production';
}

/** Split SWAGGER_SERVERS CSV into a trimmed, deduped list. Empty in → empty out. */
export function parseSwaggerServers(csv: string): string[] {
  const seen = new Set<string>();
  for (const raw of csv.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }
  return [...seen];
}

/**
 * Redact secret-shaped substrings before they land in the OpenAPI
 * `info.description`. Cheap defence-in-depth — the env-driven
 * description is free text, so we mask anything that looks like
 * an upper-snake secret name (`SECRET_FOO=...`, `KEY=...`) the
 * operator accidentally pasted in.
 *
 * ponytail: regex-only; doesn't catch real-world secrets that don't
 * match this pattern. Replace with a structured metadata field
 * (e.g. `SWAGGER_CONTACT_EMAIL`, `SWAGGER_LICENSE_NAME`) when richer
 * input ever lands — until then this is good-enough and zero-dep.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  return input.replace(/\b(?:SECRET|TOKEN|KEY|PASSWORD|API_KEY)_[A-Z0-9_]+/g, '[redacted]');
}
