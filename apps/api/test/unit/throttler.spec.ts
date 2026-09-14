import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ThrottlerEnv } from '../../src/security/throttler-env.js';
import {
  __testing__,
  buildThrottlerOptions,
  getThrottlerKey,
  getThrottlerTracker,
} from '../../src/security/throttler.config.js';
import { ValkeyThrottlerStorage } from '../../src/security/valkey-throttler.storage.js';

const baseEnv = (overrides: Partial<ThrottlerEnv> = {}): ThrottlerEnv => ({
  THROTTLE_ENABLED: true,
  THROTTLE_TTL_SECONDS: 60,
  THROTTLE_LOGIN_LIMIT: 5,
  THROTTLE_SIGNUP_LIMIT: 3,
  THROTTLE_PASSWORD_RESET_LIMIT: 3,
  THROTTLE_MAGIC_LINK_LIMIT: 5,
  THROTTLE_MFA_LIMIT: 10,
  THROTTLE_DEFAULT_LIMIT: 60,
  THROTTLE_VALKEY_URL: '',
  ...overrides,
} as unknown as ThrottlerEnv);

// Helper to fabricate an ExecutionContext with a given request.
function makeCtx(url: string, clsName = 'AuthController', handlerName = 'handle'): ExecutionContext {
  const http = {
    getRequest: () => ({ url, ip: '1.2.3.4' }),
    getResponse: () => ({}),
  };
  return {
    switchToHttp: () => http as never,
    getClass: () => ({ name: clsName }) as never,
    getHandler: () => ({ name: handlerName }) as never,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('getThrottlerTracker', () => {
  it('keys on user.id when authenticated (defends against NAT sharing)', () => {
    expect(getThrottlerTracker({ ip: '1.2.3.4', user: { id: 'u-1' } })).toBe('user:u-1');
  });

  it('keys on ip when unauthenticated', () => {
    expect(getThrottlerTracker({ ip: '5.6.7.8' })).toBe('ip:5.6.7.8');
  });

  it('falls back to ip when authenticated but user.id is missing', () => {
    expect(getThrottlerTracker({ ip: '5.6.7.8', user: {} })).toBe('ip:5.6.7.8');
    expect(getThrottlerTracker({ ip: '5.6.7.8', user: null })).toBe('ip:5.6.7.8');
  });

  it('strips trailing port from IPv6-mapped addresses', () => {
    expect(getThrottlerTracker({ ip: '::ffff:1.2.3.4:54321' })).toBe('ip:::ffff:1.2.3.4');
    expect(getThrottlerTracker({ ip: '127.0.0.1:6379' })).toBe('ip:127.0.0.1');
  });

  it('returns ip:unknown when neither user nor ip present', () => {
    expect(getThrottlerTracker({})).toBe('ip:unknown');
  });
});

describe('getThrottlerKey', () => {
  it('produces distinct keys for different URLs (per-route buckets)', () => {
    const tracker = 'ip:1.2.3.4';
    const ctx1 = makeCtx('/auth/sign-in/email');
    const ctx2 = makeCtx('/auth/sign-up/email');
    expect(getThrottlerKey(ctx1, tracker, 'auth')).not.toBe(getThrottlerKey(ctx2, tracker, 'auth'));
  });

  it('produces distinct keys for different trackers (per-IP buckets)', () => {
    const ctx = makeCtx('/auth/sign-in/email');
    expect(getThrottlerKey(ctx, 'ip:1.2.3.4', 'auth')).not.toBe(getThrottlerKey(ctx, 'ip:5.6.7.8', 'auth'));
  });

  it('produces distinct keys for different throttler names', () => {
    const ctx = makeCtx('/auth/sign-in/email');
    expect(getThrottlerKey(ctx, 'ip:1.2.3.4', 'auth')).not.toBe(getThrottlerKey(ctx, 'ip:1.2.3.4', 'global'));
  });

  it('ignores query string in URL', () => {
    const tracker = 'ip:1.2.3.4';
    const a = makeCtx('/auth/sign-in/email');
    const b = makeCtx('/auth/sign-in/email?redirect=/foo');
    expect(getThrottlerKey(a, tracker, 'auth')).toBe(getThrottlerKey(b, tracker, 'auth'));
  });
});

describe('skipIf routing', () => {
  it('skips /health and /metrics on both throttlers', () => {
    const env = baseEnv();
    const opts = buildThrottlerOptions(env);
    expect(opts).not.toBeNull();
    // narrow
    const cfg = opts as NonNullable<typeof opts>;
    if (Array.isArray(cfg)) throw new Error('expected object form');
    for (const t of cfg.throttlers) {
      const skipIf = t.skipIf!;
      const probeCtx = makeCtx('/health');
      const probeCtx2 = makeCtx('/metrics');
      expect(skipIf(probeCtx)).toBe(true);
      expect(skipIf(probeCtx2)).toBe(true);
    }
  });

  it('does NOT skip /auth/* paths on the auth throttler', () => {
    const env = baseEnv();
    const opts = buildThrottlerOptions(env) as Exclude<ReturnType<typeof buildThrottlerOptions>, null>;
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    const ctx = makeCtx('/auth/sign-in/email');
    expect(auth.skipIf!(ctx)).toBe(false);
  });

  it('skips non-/auth paths on the auth throttler', () => {
    const env = baseEnv();
    const opts = buildThrottlerOptions(env) as Exclude<ReturnType<typeof buildThrottlerOptions>, null>;
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    expect(auth.skipIf!(makeCtx('/cities'))).toBe(true);
    expect(auth.skipIf!(makeCtx('/issues/abc'))).toBe(true);
  });

  it('does NOT skip non-probe paths on the global throttler', () => {
    const env = baseEnv();
    const opts = buildThrottlerOptions(env) as Exclude<ReturnType<typeof buildThrottlerOptions>, null>;
    if (Array.isArray(opts)) throw new Error('expected object form');
    const global = opts.throttlers.find((t) => t.name === 'global')!;
    expect(global.skipIf!(makeCtx('/cities'))).toBe(false);
    expect(global.skipIf!(makeCtx('/auth/sign-in/email'))).toBe(false);
  });
});

describe('buildThrottlerOptions', () => {
  it('returns null when THROTTLE_ENABLED=false (no-op)', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_ENABLED: false }));
    expect(opts).toBeNull();
  });

  it('uses THROTTLE_LOGIN_LIMIT for the auth throttler', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_LOGIN_LIMIT: 7 })) as Exclude<
      ReturnType<typeof buildThrottlerOptions>,
      null
    >;
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    expect(auth.limit).toBe(7);
  });

  it('uses THROTTLE_DEFAULT_LIMIT for the global throttler', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_DEFAULT_LIMIT: 120 })) as Exclude<
      ReturnType<typeof buildThrottlerOptions>,
      null
    >;
    if (Array.isArray(opts)) throw new Error('expected object form');
    const global = opts.throttlers.find((t) => t.name === 'global')!;
    expect(global.limit).toBe(120);
  });

  it('converts THROTTLE_TTL_SECONDS to milliseconds', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_TTL_SECONDS: 30 })) as Exclude<
      ReturnType<typeof buildThrottlerOptions>,
      null
    >;
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.throttlers.every((t) => t.ttl === 30_000)).toBe(true);
  });

  it('attaches ValkeyThrottlerStorage when THROTTLE_VALKEY_URL is set', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_VALKEY_URL: 'redis://localhost:6379' })) as Exclude<
      ReturnType<typeof buildThrottlerOptions>,
      null
    >;
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.storage).toBeInstanceOf(ValkeyThrottlerStorage);
  });

  it('omits storage when THROTTLE_VALKEY_URL is empty (in-memory fallback)', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_VALKEY_URL: '' })) as Exclude<
      ReturnType<typeof buildThrottlerOptions>,
      null
    >;
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.storage).toBeUndefined();
  });
});

describe('ValkeyThrottlerStorage.increment', () => {
  function makeClient() {
    // Minimal mock of the parts of ioredis Redis we exercise:
    // defineCommand registers a named command (the Lua script).
    // We intercept the registered command and record calls.
    const calls: Array<{ cmd: string; args: unknown[] }> = [];
    let registeredHandler: ((...args: unknown[]) => Promise<unknown>) | undefined;
    return {
      defineCommand: vi.fn((_name: string, _def: unknown) => {
        // The implementation calls `client.throttlerIncrement(...)` later.
        // We model that by attaching a dynamic method below.
      }),
      // Dynamic method added by the storage's defineCommand call:
      throttlerIncrement: (...args: unknown[]) => {
        calls.push({ cmd: 'throttlerIncrement', args });
        return registeredHandler?.(...args) ?? Promise.resolve([1, 60_000, 0, 0]);
      },
      // Test control:
      __setHandler: (h: typeof registeredHandler) => {
        registeredHandler = h;
      },
      __calls: calls,
    };
  }

  it('issues a single atomic increment via defineCommand on construction', () => {
    const client = makeClient();
    // Mimic ioredis.defineCommand by making throttlerIncrement callable.
    const storage = new ValkeyThrottlerStorage(client as never);
    expect(client.defineCommand).toHaveBeenCalledWith('throttlerIncrement', expect.objectContaining({ lua: expect.any(String) }));
    // Sanity: storage exists.
    expect(storage).toBeInstanceOf(ValkeyThrottlerStorage);
  });

  it('forwards counterKey, blockKey, ttl, limit, blockDuration to the script', async () => {
    const client = makeClient();
    const storage = new ValkeyThrottlerStorage(client as never);
    client.__setHandler(() => Promise.resolve([1, 60_000, 0, 0]));

    await storage.increment('abc', 60_000, 5, 60_000, 'auth');

    expect(client.__calls).toHaveLength(1);
    const args = client.__calls[0]!.args;
    // Expect: [counterKey, blockKey, ttlMs, limit, blockDurationMs]
    expect(args[0]).toBe('throttle:auth:abc');
    expect(args[1]).toBe('throttle:auth:abc:block');
    expect(args[2]).toBe(60_000);
    expect(args[3]).toBe(5);
    expect(args[4]).toBe(60_000);
  });

  it('returns the record mapped to seconds', async () => {
    const client = makeClient();
    const storage = new ValkeyThrottlerStorage(client as never);
    // Lua returns: [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs]
    client.__setHandler(() => Promise.resolve([7, 12_500, 1, 5_500]));

    const r = await storage.increment('k', 60_000, 5, 60_000, 'auth');
    expect(r).toEqual({
      totalHits: 7,
      timeToExpire: 13, // ceil(12_500/1000)
      isBlocked: true,
      timeToBlockExpire: 6, // ceil(5_500/1000)
    });
  });

  it('clamps -1 / -2 PTTL values (Redis sentinel for no TTL / no key) to 0', async () => {
    const client = makeClient();
    const storage = new ValkeyThrottlerStorage(client as never);
    client.__setHandler(() => Promise.resolve([1, -2, 0, -1]));

    const r = await storage.increment('k', 60_000, 5, 60_000, 'auth');
    expect(r.timeToExpire).toBe(0);
    expect(r.timeToBlockExpire).toBe(0);
  });

  it('keys include the throttler name so distinct buckets stay distinct', async () => {
    const client = makeClient();
    const storage = new ValkeyThrottlerStorage(client as never);
    client.__setHandler(() => Promise.resolve([1, 60_000, 0, 0]));

    await storage.increment('xyz', 60_000, 5, 60_000, 'auth');
    await storage.increment('xyz', 60_000, 5, 60_000, 'global');

    const authKey = client.__calls[0]!.args[0];
    const globalKey = client.__calls[1]!.args[0];
    expect(authKey).toBe('throttle:auth:xyz');
    expect(globalKey).toBe('throttle:global:xyz');
    expect(authKey).not.toBe(globalKey);
  });
});

// ponytail: this is the test the deviation asks for ("Storage atomicity
// (concurrent requests don't slip past the limit)"). The atomicity comes
// from the single Lua execution on the Redis server — proven by the
// script using INCR which is atomic + PEXPIRE on first-hit only + PSETEX
// for the block marker. We can't simulate a real race in a unit test
// (would need a real Redis), so we assert the script's structure: it
// must combine all three ops into a single command, never pipeline them
// separately (which would leak a TOCTOU window).
describe('ValkeyThrottlerStorage atomicity (script structure)', () => {
  it('combines INCR + PEXPIRE + EXISTS + PSETEX in one Lua script', () => {
    // Grab the registered Lua source via defineCommand call args.
    const client = {
      defineCommand: vi.fn(),
    };
    new ValkeyThrottlerStorage(client as never);
    const call = client.defineCommand.mock.calls[0]!;
    const def = call[1] as { lua: string; numberOfKeys: number };
    expect(def.numberOfKeys).toBe(2);
    expect(def.lua).toContain('INCR');
    expect(def.lua).toContain('PEXPIRE');
    expect(def.lua).toContain('EXISTS');
    expect(def.lua).toContain('PSETEX');
    // All four operations must be present in a single script body.
    // If any of these is missing or split out, atomicity is broken.
  });
});

// Internal helpers exposed for tests via __testing__.
describe('path routing helpers', () => {
  it('strips query string', () => {
    expect(__testing__.pathOf({ url: '/auth/sign-in/email?redirect=/x' })).toBe('/auth/sign-in/email');
  });

  it('returns empty string for missing URL', () => {
    expect(__testing__.pathOf(undefined)).toBe('');
    expect(__testing__.pathOf({})).toBe('');
  });

  it('isAuthRoute matches /auth and /auth/*', () => {
    expect(__testing__.isAuthRoute({ url: '/auth' })).toBe(true);
    expect(__testing__.isAuthRoute({ url: '/auth/sign-in/email' })).toBe(true);
    expect(__testing__.isAuthRoute({ url: '/auth/mfa/verify' })).toBe(true);
  });

  it('isAuthRoute excludes /authoring-foo (prefix boundary)', () => {
    // Make sure the prefix match doesn't accidentally catch unrelated paths.
    expect(__testing__.isAuthRoute({ url: '/authoring-foo' })).toBe(false);
  });

  it('isProbeRoute matches /health and /metrics exactly', () => {
    expect(__testing__.isProbeRoute({ url: '/health' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/metrics' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/cities' })).toBe(false);
    expect(__testing__.isProbeRoute({ url: '/healthcheck' })).toBe(false);
  });
});
