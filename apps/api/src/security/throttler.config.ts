import { createHash } from 'node:crypto';

import type { DynamicModule, ExecutionContext } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { Redis } from 'ioredis';

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
  // Strip the trailing port from IPv6 loopback ("::1" → "::1", "::ffff:1.2.3.4:5000" → "::ffff:1.2.3.4")
  // so two requests from the same physical host share a bucket regardless
  // of ephemeral source port.
  const ip = (req.ip ?? 'unknown').replace(/:\d+$/, '');
  return `ip:${ip}`;
}

/**
 * Generate the storage key. Includes the URL path so each route gets its
 * own bucket per (tracker, throttler) pair — login and signup don't
 * share a counter even though they're both proxied through the same
 * Better Auth wildcard handler. Hashing keeps the key length bounded.
 */
export function getThrottlerKey(context: ExecutionContext, tracker: string, name: string): string {
  const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
  // Use just the pathname — query strings shouldn't affect the bucket,
  // and the path is normalized by Fastify (no trailing slash, no `..`).
  const path = (req.url ?? '').split('?')[0] ?? '';
  const cls = context.getClass().name;
  const handler = context.getHandler().name;
  const h = createHash('sha256');
  h.update(`${cls}|${handler}|${path}|${name}|${tracker}`);
  return h.digest('hex');
}

/**
 * Strip query string and normalize path for skipIf checks.
 */
function pathOf(req: { url?: string } | undefined): string {
  return (req?.url ?? '').split('?')[0] ?? '';
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
  return pathOf(req).startsWith('/auth/') || pathOf(req) === '/auth';
}

/**
 * Build the throttler module config for `ThrottlerModule.forRootAsync`.
 * Returns `null` when `THROTTLE_ENABLED=false` — the caller wires the
 * throttler module conditionally so the global guard is never
 * registered in disabled mode (otherwise `@Throttle()` decorators on
 * controllers would throw "throttler options not found" at boot).
 *
 * Two named throttlers:
 *   - `'auth'`   — limit = THROTTLE_LOGIN_LIMIT (default 5), scope to
 *                 /auth/* via skipIf. Each URL is its own bucket per
 *                 (tracker, name) so login, signup, password-reset,
 *                 magic-link, MFA verify don't share counters.
 *   - `'global'` — limit = THROTTLE_DEFAULT_LIMIT (default 60), scope
 *                 to everything EXCEPT /health + /metrics. The
 *                 generous baseline so legitimate traffic never trips,
 *                 while still catching obvious abuse.
 *
 * Storage choice:
 *   - THROTTLE_VALKEY_URL set → Redis-backed (multi-instance safe,
 *     atomic via Lua). Production sets this so counters survive across
 *     replicas.
 *   - empty → in-memory (single-instance only; lose counts on restart;
 *     fine for dev).
 */
export function buildThrottlerOptions(env: ThrottlerEnv): ThrottlerModuleOptions | null {
  if (!env.THROTTLE_ENABLED) return null;

  const ttlMs = env.THROTTLE_TTL_SECONDS * 1000;
  const storage = env.THROTTLE_VALKEY_URL
    ? new ValkeyThrottlerStorage(new Redis(env.THROTTLE_VALKEY_URL, { lazyConnect: true }))
    : undefined; // undefined → ThrottlerStorageProvider falls back to in-memory

  return {
    throttlers: [
      {
        name: 'auth',
        ttl: ttlMs,
        limit: env.THROTTLE_LOGIN_LIMIT,
        skipIf: (ctx) => !isAuthRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => getThrottlerTracker(req as AuthenticatedRequest),
        generateKey: (ctx, tracker, name) => getThrottlerKey(ctx, tracker, name),
      },
      {
        name: 'global',
        ttl: ttlMs,
        limit: env.THROTTLE_DEFAULT_LIMIT,
        skipIf: (ctx) => isProbeRoute(ctx.switchToHttp().getRequest()),
        getTracker: (req: Record<string, unknown>) => getThrottlerTracker(req as AuthenticatedRequest),
        generateKey: (ctx, tracker, name) => getThrottlerKey(ctx, tracker, name),
      },
    ],
    ...(storage ? { storage } : {}),
  };
}

/**
 * Re-export the `ThrottlerModule.forRootAsync` shape that wires
 * `buildThrottlerOptions` for NestJS. Kept as a thin helper so the
 * conditional-registration dance lives in one place — AppModule just
 * calls `throttlerModuleForRoot(env)` and gets either a real module or
 * a no-op DynamicModule.
 */
export function throttlerModuleForRoot(env: ThrottlerEnv): DynamicModule {
  if (!env.THROTTLE_ENABLED) {
    // No-op module — ThrottlerModule is registered as global so the
    // Decorator metadata doesn't error, but with zero throttlers nothing
    // is checked. The other half: don't wire ThrottlerGuard as APP_GUARD.
    return { module: ThrottlerModule, global: true };
  }
  return ThrottlerModule.forRootAsync({
    useFactory: () => {
      const opts = buildThrottlerOptions(env);
      // buildThrottlerOptions returns non-null when enabled; the cast
      // is a no-op assertion for the type system.
      return opts as ThrottlerModuleOptions;
    },
  });
}

// Exported for tests.
export const __testing__ = { pathOf, isProbeRoute, isAuthRoute };
