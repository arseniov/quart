import pino, { type LoggerOptions } from 'pino';

import type { ConfigService } from '../config/config.service.js';

/**
 * Pino redaction list. Security baseline: never log PII or auth material.
 *
 * Required paths (per plan + prompt):
 *   - req.headers.authorization, req.headers.cookie
 *   - res.headers["set-cookie"]
 *   - password, token, secret
 *   - *.password, *.token, *.secret
 *   - *.hmac_key, *.signing_key, *.better_auth_secret
 */
export const redactionPaths: readonly string[] = [
  // Request headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  // Response headers
  'res.headers["set-cookie"]',
  // Top-level body fields (defensive: covers single-key payloads)
  'password',
  'token',
  'secret',
  // Common request body fields
  'req.body.password',
  'req.body.new_password',
  'req.body.token',
  'req.body.refresh_token',
  'req.body.totp_code',
  'req.body.code',
  // DB / object wildcard patterns
  '*.password',
  '*.token',
  '*.secret',
  '*.hmac_key',
  '*.signing_key',
  '*.better_auth_secret',
  '*.BETTER_AUTH_SECRET',
  '*.JWT_SIGNING_KEY',
  '*.JWT_ISSUER',
  // PII — request body
  'req.body.email',
  'req.body.phone',
  'req.body.phoneNumber',
  'req.body.location',
  // T17 MFA — backup codes are auth credentials (single-use recovery
  // tokens). Plaintext lives only in the enroll response; never log it.
  'req.body.code',
  'req.body.backup_code',
  '*.backupCodes',
  '*.backup_codes',
  '*.backupCodesHash',
  '*.backup_codes_hash',
  // PII — DB / object wildcard patterns
  '*.email',
  '*.phone_e164',
  '*.phone',
  '*.phoneNumber',
  '*.ip',
  '*.user_agent',
  '*.lat',
  '*.lng',
  '*.address',
  // Audit chain — HMAC key, payloads, and hashes (T19/T20)
  '*.AUDIT_HMAC_KEY',
  '*.payload',
  '*.payload.*',
  '*.payload_redacted',
  '*.payload_canonical_sha256',
  '*.row_hash',
  '*.prev_hash',
  // T37 — push tokens identify a physical device; redact the `to` field on
  // any Expo-style payload (`{to, title, body, ...}`).
  '*.to',
];

export function buildLoggerOptions(config: ConfigService): LoggerOptions {
  return {
    level: config.env.LOG_LEVEL,
    redact: { paths: [...redactionPaths], censor: '[redacted]' },
    base: { service: 'quart-api', env: config.env.NODE_ENV },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}
