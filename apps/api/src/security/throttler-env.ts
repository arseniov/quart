import { z } from 'zod';

/**
 * Narrow schema for `@nestjs/throttler` configuration. Parsed separately
 * from `EnvSchema` so contexts without DB / Valkey (workers, scripts, test
 * rigs) can still surface throttler decisions without pulling the full app
 * config. Same shape as `SecurityEnvSchema` — env defaults match the spec.
 *
 * `THROTTLE_ENABLED=false` short-circuits the whole throttler module: the
 * throttler module is not registered, `ThrottlerGuard` is never wired, and
 * `@Throttle()` decorators become inert metadata. Test rigs and dev boots
 * with disabled throttling (lots of hammering) should set this rather than
 * inflating every limit.
 */
export const ThrottlerEnvSchema = z.object({
  // Master switch. Defaults true; set to 'false' to no-op the throttler.
  THROTTLE_ENABLED: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .default(true),

  // TTL in seconds. All named buckets share this window for now.
  // ponytail: per-route TTL knobs add config surface without a proven need;
  // split when an endpoint legitimately needs a longer/shorter window.
  THROTTLE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),

  // Auth-specific limits. Currently all five feed the SAME 'auth' throttler
  // bucket (per-path via the URL-encoded tracker), so they share counters
  // across actions. Schema reserves the names so future per-action
  // throttlers can be wired without a config migration.
  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().min(1).default(5),
  THROTTLE_SIGNUP_LIMIT: z.coerce.number().int().min(1).default(3),
  THROTTLE_PASSWORD_RESET_LIMIT: z.coerce.number().int().min(1).default(3),
  THROTTLE_MAGIC_LINK_LIMIT: z.coerce.number().int().min(1).default(5),
  THROTTLE_MFA_LIMIT: z.coerce.number().int().min(1).default(10),

  // Global default — generous enough that legitimate traffic never trips.
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().min(1).default(60),

  // Optional Valkey URL. When present, rate-limit counters live in Valkey
  // so multi-instance deployments share one bucket. When empty, fall back
  // to the in-memory storage (single-instance only).
  THROTTLE_VALKEY_URL: z.string().default(''),
});

export type ThrottlerEnv = z.infer<typeof ThrottlerEnvSchema>;
