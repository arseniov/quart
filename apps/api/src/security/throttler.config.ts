import { createHash } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import { Logger, type Provider } from '@nestjs/common';
import type { ThrottlerAsyncOptions, ThrottlerModuleOptions } from '@nestjs/throttler';

import { ValkeyService } from '../auth/valkey.service.js';

import type { ThrottlerEnv } from './throttler-env.js';
import { ValkeyThrottlerStorage } from './valkey-throttler.storage.js';

/**
 * Snapshot of `req.user` populated by JwtAuthGuard. The throttler runs
 * AFTER JwtAuthGuard in Nest's guard pipeline, so on protected routes
 * `req.user` is set. On `@Public()` routes (Better Auth sign-in, magic-link,
 * health) it's absent — we fall back to IP-based keying.
 */
interface AuthenticatedRequest {
  ip?: string;
  user?: { id?: string } | null;
  url?: string;
  body?: { phoneNumber?: string } | Record<string, unknown>;
}

/**
 * Normalize IPv6-mapped IPv4 addresses. Node/Fastify hands us
 * `::ffff:1.2.3.4` for IPv4-over-IPv6 sockets and `::1` for the IPv6
 * loopback. The two ports (`:port` on a real IPv4 host, ephemeral port
 * on mapped IPv6) are NOT stripped — they're not part of the address.
 *
 * Only the well-known `::ffff:` prefix and `::1` loopback are unwrapped;
 * every other IPv6 form (e.g. `2001:db8::1`) passes through unchanged
 * because stripping anything else would alias distinct hosts.
 */
function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, '').replace(/^::1$/, '127.0.0.1');
}

/**
 * Extract the tracker suffix used by the throttler. When a user is
 * authenticated, key on `user:{id}` so attackers behind a NAT share a
 * bucket but a single user can't DoS themselves by sharing an IP with
 * an attacker. Otherwise key on `ip:{ip}` (Fastify already resolves
 * `req.ip` against `trustProxy`, so XFF is only honored when the
 * operator opted in via TRUST_PROXY=true).
 */
export function getThrottlerTracker(req: AuthenticatedRequest): string {
  const userId = req.user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${normalizeIp(req.ip ?? 'unknown')}`;
}

/**
 * Per-phone tracker for the `phone` throttler bucket. Spec says
 * "5/min/phone", but a phone-OTP request that's missing `phoneNumber`
 * still needs a bucket (otherwise the bucket is shared with all
 * malformed requests from the same IP). Falls back to IP in that case.
 *
 * ponytail: full per-phone enforcement would require rejecting
 * unparseable bodies before the throttler sees them — out of scope
 * for T44. Log a follow-up when an attacker actually exploits the
 * fallback.
 */
export function getPhoneTracker(req: AuthenticatedRequest): string {
  const phone = (req.body as { phoneNumber?: unknown } | undefined)?.phoneNumber;
  if (typeof phone === 'string' && phone.length > 0) return `phone:${phone}`;
  return `ip:${normalizeIp(req.ip ?? 'unknown')}`;
}

/**
 * Generate the storage key. Includes the URL path so each route gets its
 * own bucket per (tracker, throttler) pair — login and signup don't
 * share a counter even though they're both proxied through the same
 * Better Auth wildcard handler. Hashing keeps the key length bounded.
 *
 * Note: `name` is intentionally NOT included — it's already encoded in
 * the Redis key prefix by ValkeyThrottlerStorage, and re-hashing it just
 * dilutes the per-name bucket isolation. Including it here would only
 * matter if two throttlers ever shared the same Redis keyspace.
 */
export function getThrottlerKey(
  context: ExecutionContext,
  tracker: string,
  // Throttler name. Unused in the hash (already encoded in the Redis key
  // prefix by ValkeyThrottlerStorage and in the Lua-script keys); kept in
  // the signature so the binding matches `ThrottlerGenerateKeyFunction`.
  _name?: string,
): string {
  const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
  // Use just the pathname — query strings shouldn't affect the bucket,
  // and the path is normalized by Fastify (no trailing slash, no `..`).
  const path = (req.url ?? '').split('?')[0] ?? '';
  const cls = context.getClass().name;
  const handler = context.getHandler().name;
  const h = createHash('sha256');
  h.update(`${cls}|${handler}|${path}|${tracker}`);
  return h.digest('hex');
}

/**
 * Strip query string and normalize path for skipIf checks. Compared
 * case-insensitively because route prefixes like `/Health` (rare but
 * possible via a misconfigured upstream) shouldn't bypass the throttler.
 */
function pathOf(req: { url?: string } | undefined): string {
  return ((req?.url ?? '').split('?')[0] ?? '').toLowerCase();
}

/**
 * Probe routes — scraped at high frequency (Prometheus every 15s, k8s
 * liveness every 5–10s). Must never trip the throttler or return 429
 * to the scraper.
 */
function isProbeRoute(req: { url?: string }): boolean {
  const path = pathOf(req);
  return path === '/health' || path === '/metrics';
}

/**
 * Auth-scoped routes — Better Auth's sign-in/sign-up/forget-password/mfa
 * proxies, our own phone-otp + mfa controllers, etc. Paths starting
 * with `/auth/`.
 */
function isAuthRoute(req: { url?: string }): boolean {
  const path = pathOf(req);
  return path.startsWith('/auth/') || path === '/auth';
}

/**
 * Phone-OTP routes only — `/auth/phone/request` and `/auth/phone/verify`.
 * Scoped to the `phone` throttler bucket so the limit is per-phone-number
 * rather than per-IP (an attacker iterating phones from one IP would
 * otherwise multiply the budget).
 */
function isPhoneOtpRoute(req: { url?: string }): boolean {
  const path = pathOf(req);
  return path.startsWith('/auth/phone/') || path === '/auth/phone';
}

/**
 * Magic-link routes only — `/auth/magic-link/request`. Scoped to the
 * `magiclink` throttler bucket so the budget is per-email rather than
 * per-IP. Verify is rate-limited by the `auth` bucket alone — it's not
 * an enumeration vector (tokens are 64-hex single-use).
 */
function isMagicLinkRoute(req: { url?: string }): boolean {
  const path = pathOf(req);
  // Only the request endpoint issues tokens; verify is key-search-resistant.
  return path.startsWith('/auth/magic-link/request') || path === '/auth/magic-link/request';
}

/**
 * Password-reset forgot routes only — `/auth/password/forgot`. Scoped to
 * the `passwordreset` throttler bucket so the budget is per-email rather
 * than per-IP. Reset is rate-limited by the `auth` bucket alone — token
 * is 256-bit single-use.
 */
function isPasswordResetRoute(req: { url?: string }): boolean {
  const path = pathOf(req);
  return path.startsWith('/auth/password/forgot') || path === '/auth/password/forgot';
}

/**
 * Per-email tracker for the `magiclink` bucket. Falls back to IP when the
 * body is missing/has no email — same caveat as the phone tracker (T44).
 */
export function getMagicLinkTracker(req: AuthenticatedRequest): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = body?.email;
  if (typeof email === 'string' && email.length > 0) return `email:${email.toLowerCase()}`;
  return `ip:${normalizeIp(req.ip ?? 'unknown')}`;
}

/**
 * Per-email tracker for the `passwordreset` bucket. Same shape as
 * `getMagicLinkTracker` — separate function so we don't couple the two
 * buckets if either ever needs to diverge.
 */
export function getPasswordResetTracker(req: AuthenticatedRequest): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = body?.email;
  if (typeof email === 'string' && email.length > 0) return `email:${email.toLowerCase()}`;
  return `ip:${normalizeIp(req.ip ?? 'unknown')}`;
}

/**
 * Provider token so the throttler config can be re-injected without
 * circular-importing AppModule.
 */
export const VALKEY_THROTTLER_STORAGE = Symbol('VALKEY_THROTTLER_STORAGE');

/**
 * Factory that builds the throttler module options. Receives the shared
 * ValkeyService so we reuse the connection owned by AuthModule — no
 * separate Redis client to lifecycle.
 */
export function buildThrottlerOptions(
  env: ThrottlerEnv,
  valkey: ValkeyService | null,
): ThrottlerModuleOptions {
  const ttlMs = env.THROTTLE_TTL_SECONDS * 1000;
  const storage = env.THROTTLE_VALKEY_URL && valkey
    ? new ValkeyThrottlerStorage(valkey.client)
    : undefined; // undefined → ThrottlerStorageProvider falls back to in-memory

  // Logger for the fail-open path; created once per factory call.
  const logger = new Logger('Throttler');

  return {
    throttlers: [
      {
        name: 'auth',
        ttl: ttlMs,
        limit: env.THROTTLE_LOGIN_LIMIT,
        skipIf: (ctx) => !isAuthRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => getThrottlerTracker(req as AuthenticatedRequest),
        generateKey: (ctx, tracker) => getThrottlerKey(ctx, tracker),
      },
      {
        name: 'phone',
        ttl: ttlMs,
        limit: 5,
        // Skip everywhere except phone-OTP routes — non-phone auth still
        // uses the `auth` bucket; phone-OTP gets its own (per-phone)
        // bucket on top.
        skipIf: (ctx) => !isPhoneOtpRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => {
          try {
            return getPhoneTracker(req as AuthenticatedRequest);
          } catch (err) {
            logger.warn({ err: String(err) }, '[throttler] phone tracker failed; using ip');
            return `ip:${normalizeIp((req as AuthenticatedRequest).ip ?? 'unknown')}`;
          }
        },
        generateKey: (ctx, tracker) => getThrottlerKey(ctx, tracker),
      },
      {
        name: 'magiclink',
        ttl: ttlMs,
        // Bucket default = 10/min; per-endpoint @Throttle can override.
        // The magic-link controller pins it to 10 (T54 spec).
        limit: env.THROTTLE_MAGIC_LINK_LIMIT,
        skipIf: (ctx) => !isMagicLinkRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => {
          try {
            return getMagicLinkTracker(req as AuthenticatedRequest);
          } catch (err) {
            logger.warn({ err: String(err) }, '[throttler] magiclink tracker failed; using ip');
            return `ip:${normalizeIp((req as AuthenticatedRequest).ip ?? 'unknown')}`;
          }
        },
        generateKey: (ctx, tracker) => getThrottlerKey(ctx, tracker),
      },
      {
        name: 'passwordreset',
        ttl: ttlMs,
        // Default 3/min per ThrottlerEnvSchema (separate bucket from
        // magiclink). The password-reset controller pins it to 10/min
        // via @Throttle — this default guards the bucket-only path
        // (operators tune via THROTTLE_PASSWORD_RESET_LIMIT).
        limit: env.THROTTLE_PASSWORD_RESET_LIMIT,
        skipIf: (ctx) => !isPasswordResetRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => {
          try {
            return getPasswordResetTracker(req as AuthenticatedRequest);
          } catch (err) {
            logger.warn({ err: String(err) }, '[throttler] passwordreset tracker failed; using ip');
            return `ip:${normalizeIp((req as AuthenticatedRequest).ip ?? 'unknown')}`;
          }
        },
        generateKey: (ctx, tracker) => getThrottlerKey(ctx, tracker),
      },
      {
        name: 'global',
        ttl: ttlMs,
        limit: env.THROTTLE_DEFAULT_LIMIT,
        skipIf: (ctx) => isProbeRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => getThrottlerTracker(req as AuthenticatedRequest),
        generateKey: (ctx, tracker) => getThrottlerKey(ctx, tracker),
      },
    ],
    ...(storage ? { storage } : {}),
  };
}

/**
 * Nest DI providers for the throttler module. AppModule wires these
 * alongside the `ThrottlerModule.forRootAsync({ useFactory: ... })`
 * import so the factory has access to ValkeyService (which lives in
 * AuthModule).
 */
export function throttlerProviders(env: ThrottlerEnv): Provider[] {
  if (!env.THROTTLE_ENABLED) return [];
  return [
    {
      provide: VALKEY_THROTTLER_STORAGE,
      useFactory: (valkey: ValkeyService | null) =>
        env.THROTTLE_VALKEY_URL && valkey ? new ValkeyThrottlerStorage(valkey.client) : null,
      inject: [{ token: ValkeyService, optional: true }],
    },
  ];
}

/**
 * Build the ThrottlerModule.forRootAsync options. Used by AppModule.
 * When `THROTTLE_ENABLED=false` the caller should NOT import this
 * module at all — the global ThrottlerGuard provider is also gated.
 */
export function throttlerModuleForRootAsync(env: ThrottlerEnv): ThrottlerAsyncOptions {
  return {
    inject: [{ token: ValkeyService, optional: true }],
    useFactory: (valkey: ValkeyService | null) => buildThrottlerOptions(env, valkey),
  };
}

// Exported for tests.
export const __testing__ = {
  pathOf,
  isProbeRoute,
  isAuthRoute,
  isPhoneOtpRoute,
  isMagicLinkRoute,
  isPasswordResetRoute,
  normalizeIp,
};