import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_PRIVATE: z.string().min(1),
  MINIO_BUCKET_PUBLIC: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  JWT_SIGNING_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'Ed25519 hex key expected (64 hex chars = 32 bytes)'),
  JWT_ISSUER: z.string().min(1),

  AUDIT_HMAC_KEY: z.string().regex(/^[0-9a-f]{64}$/i),

  // Base64-encoded 32 bytes — the KEK used to wrap per-city DEKs before they
  // land in `pii_key_versions.dek_encrypted`. Production MUST source this from
  // KMS at startup; the dev seed (0023) writes the same role into kek_versions.
  KEK_BASE64: z
    .string()
    .refine(
      (s) => Buffer.from(s, 'base64').length === 32,
      'KEK_BASE64 must decode to exactly 32 bytes (AES-256)',
    ),

  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),

  QUART_ALLOW_FREE_TSA: z.enum(['true', 'false']).transform((v) => v === 'true'),
  TSA_URL: z.string().url(),

  LOG_LEVEL: z.string().default('info'),

  // Expo push delivery. EXPO_ACCESS_TOKEN is required — fail-fast at boot
  // rather than silently POSTing unauthenticated (T37 deviation #1).
  EXPO_ACCESS_TOKEN: z.string().min(1),
  // Per-request timeout. Default 10s covers the slow path of Expo's HTTP API.
  EXPO_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(10_000),

  // SES sender address (T38). Optional — empty means the email worker logs
  // every send (dev / test) and the SES provider is never wired. Production
  // sets SES_FROM_ADDRESS once SES + the verified sender are configured.
  SES_FROM_ADDRESS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;
