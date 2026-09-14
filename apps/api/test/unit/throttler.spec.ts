import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ThrottlerEnv } from '../../src/security/throttler-env.js';
import {
  __testing__,
  buildThrottlerOptions,
  getPhoneTracker,
  getThrottlerKey,
  getThrottlerTracker,
  throttlerModuleForRootAsync,
  throttlerProviders,
} from '../../src/security/throttler.config.js';
import { ValkeyThrottlerStorage } from '../../src/security/valkey-throttler.storage.js';

const baseEnv = (overrides: Partial<ThrottlerEnv> = {}): ThrottlerEnv => ({
  THROTTLE_ENABLED: true,
  THROTTLE_TTL_SECONDS: 60,
  THROTTLE_LOGIN_LIMIT: 10,
  THROTTLE_SIGNUP_LIMIT: 3,
  THROTTLE_PASSWORD_RESET_LIMIT: 3,
  THROTTLE_MAGIC_LINK_LIMIT: 5,
  THROTTLE_MFA_LIMIT: 10,
  THROTTLE_DEFAULT_LIMIT: 600,
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

  it('unwraps IPv6-mapped IPv4 (::ffff:1.2.3.4 -> 1.2.3.4)', () => {
    // Spec: normalize IPv6-mapped IPv4, do NOT strip the port from a
    // mapped address — the port is ephemeral, but stripping it would
    // also strip the port from a host's IPv4 record, which is wrong.
    expect(getThrottlerTracker({ ip: '::ffff:1.2.3.4' })).toBe('ip:1.2.3.4');
  });

  it('maps IPv6 loopback ::1 to 127.0.0.1', () => {
    expect(getThrottlerTracker({ ip: '::1' })).toBe('ip:127.0.0.1');
  });

  it('does NOT strip the trailing port from a real IPv4 host', () => {
    // The port belongs to the host's identity on the listening side.
    // No reason to alias different listening ports.
    expect(getThrottlerTracker({ ip: '127.0.0.1:6379' })).toBe('ip:127.0.0.1:6379');
  });

  it('returns ip:unknown when neither user nor ip present', () => {
    expect(getThrottlerTracker({})).toBe('ip:unknown');
  });
});

describe('getPhoneTracker', () => {
  it('keys on phoneNumber when present in body', () => {
    expect(getPhoneTracker({ ip: '1.2.3.4', body: { phoneNumber: '+15555550100' } })).toBe('phone:+15555550100');
  });

  it('falls back to ip when phoneNumber is missing', () => {
    expect(getPhoneTracker({ ip: '1.2.3.4', body: {} })).toBe('ip:1.2.3.4');
    expect(getPhoneTracker({ ip: '1.2.3.4', body: { phoneNumber: '' } })).toBe('ip:1.2.3.4');
  });

  it('normalizes IPv6-mapped IPv4 in fallback path', () => {
    expect(getPhoneTracker({ ip: '::ffff:1.2.3.4', body: {} })).toBe('ip:1.2.3.4');
  });
});

describe('getThrottlerKey', () => {
  it('produces distinct keys for different URLs (per-route buckets)', () => {
    const tracker = 'ip:1.2.3.4';
    const ctx1 = makeCtx('/auth/sign-in/email');
    const ctx2 = makeCtx('/auth/sign-up/email');
    expect(getThrottlerKey(ctx1, tracker)).not.toBe(getThrottlerKey(ctx2, tracker));
  });

  it('produces distinct keys for different trackers (per-IP buckets)', () => {
    const ctx = makeCtx('/auth/sign-in/email');
    expect(getThrottlerKey(ctx, 'ip:1.2.3.4')).not.toBe(getThrottlerKey(ctx, 'ip:5.6.7.8'));
  });

  it('ignores query string in URL', () => {
    const tracker = 'ip:1.2.3.4';
    const a = makeCtx('/auth/sign-in/email');
    const b = makeCtx('/auth/sign-in/email?redirect=/foo');
    expect(getThrottlerKey(a, tracker)).toBe(getThrottlerKey(b, tracker));
  });

  it('accepts the throttler name (kept for interface compat) without changing the hash', () => {
    // Drop from hash: per-name separation is enforced by the Valkey key prefix.
    const tracker = 'ip:1.2.3.4';
    const ctx = makeCtx('/auth/sign-in/email');
    expect(getThrottlerKey(ctx, tracker, 'auth')).toBe(getThrottlerKey(ctx, tracker, 'global'));
  });
});

describe('skipIf routing', () => {
  it('skips /health and /metrics on both throttlers', () => {
    const env = baseEnv();
    const opts = buildThrottlerOptions(env, null);
    expect(opts).not.toBeNull();
    const cfg = opts;
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
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    const ctx = makeCtx('/auth/sign-in/email');
    expect(auth.skipIf!(ctx)).toBe(false);
  });

  it('skips non-/auth paths on the auth throttler', () => {
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    expect(auth.skipIf!(makeCtx('/cities'))).toBe(true);
    expect(auth.skipIf!(makeCtx('/issues/abc'))).toBe(true);
  });

  it('does NOT skip non-probe paths on the global throttler', () => {
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const global = opts.throttlers.find((t) => t.name === 'global')!;
    expect(global.skipIf!(makeCtx('/cities'))).toBe(false);
    expect(global.skipIf!(makeCtx('/auth/sign-in/email'))).toBe(false);
  });

  it('skips non-phone paths on the phone throttler', () => {
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const phone = opts.throttlers.find((t) => t.name === 'phone')!;
    expect(phone.skipIf!(makeCtx('/auth/sign-in/email'))).toBe(true);
    expect(phone.skipIf!(makeCtx('/cities'))).toBe(true);
  });

  it('does NOT skip phone-OTP paths on the phone throttler', () => {
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const phone = opts.throttlers.find((t) => t.name === 'phone')!;
    expect(phone.skipIf!(makeCtx('/auth/phone/request'))).toBe(false);
    expect(phone.skipIf!(makeCtx('/auth/phone/verify'))).toBe(false);
  });
});

describe('buildThrottlerOptions', () => {
  it('uses THROTTLE_LOGIN_LIMIT for the auth throttler', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_LOGIN_LIMIT: 7 }), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const auth = opts.throttlers.find((t) => t.name === 'auth')!;
    expect(auth.limit).toBe(7);
  });

  it('uses THROTTLE_DEFAULT_LIMIT for the global throttler', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_DEFAULT_LIMIT: 120 }), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const global = opts.throttlers.find((t) => t.name === 'global')!;
    expect(global.limit).toBe(120);
  });

  it('hardcodes the phone throttler limit at 5/min', () => {
    const opts = buildThrottlerOptions(baseEnv(), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    const phone = opts.throttlers.find((t) => t.name === 'phone')!;
    expect(phone.limit).toBe(5);
    expect(phone.ttl).toBe(60_000);
  });

  it('converts THROTTLE_TTL_SECONDS to milliseconds', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_TTL_SECONDS: 30 }), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.throttlers.every((t) => t.ttl === 30_000)).toBe(true);
  });

  it('attaches ValkeyThrottlerStorage when URL + valkey are both present', () => {
    const opts = buildThrottlerOptions(
      baseEnv({ THROTTLE_VALKEY_URL: 'redis://localhost:6379' }),
      { client: { status: 'ready', defineCommand: () => {} } as never } as never,
    );
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.storage).toBeInstanceOf(ValkeyThrottlerStorage);
  });

  it('omits storage when THROTTLE_VALKEY_URL is empty (in-memory fallback)', () => {
    const opts = buildThrottlerOptions(baseEnv({ THROTTLE_VALKEY_URL: '' }), null);
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.storage).toBeUndefined();
  });

  it('omits storage when URL is set but valkey is null', () => {
    const opts = buildThrottlerOptions(
      baseEnv({ THROTTLE_VALKEY_URL: 'redis://localhost:6379' }),
      null,
    );
    if (Array.isArray(opts)) throw new Error('expected object form');
    expect(opts.storage).toBeUndefined();
  });
});

describe('throttlerProviders', () => {
  it('returns an empty array when THROTTLE_ENABLED=false', () => {
    expect(throttlerProviders(baseEnv({ THROTTLE_ENABLED: false }))).toEqual([]);
  });

  it('returns a VALKEY_THROTTLER_STORAGE provider when enabled', () => {
    const providers = throttlerProviders(baseEnv());
    expect(providers).toHaveLength(1);
    expect((providers[0] as { provide: symbol }).provide).toBeTypeOf('symbol');
  });
});

describe('throttlerModuleForRootAsync', () => {
  it('returns a Nest async-options object with inject + useFactory', () => {
    const opts = throttlerModuleForRootAsync(baseEnv());
    expect(opts.inject).toBeDefined();
    expect(typeof opts.useFactory).toBe('function');
  });

  it('useFactory returns options when given a valkey instance', () => {
    const opts = throttlerModuleForRootAsync(baseEnv({ THROTTLE_VALKEY_URL: 'redis://x:6379' }));
    const built = opts.useFactory({ client: { status: 'ready', defineCommand: () => {} } as never } as never);
    if (Array.isArray(built)) throw new Error('expected object form');
    expect(built.storage).toBeInstanceOf(ValkeyThrottlerStorage);
  });

  it('useFactory degrades gracefully when valkey is null (THROTTLE_ENABLED=false boot)', () => {
    // Test rig scenario: process.env has no Valkey configured. The
    // factory must NOT throw — it falls back to in-memory storage.
    const opts = throttlerModuleForRootAsync(baseEnv({ THROTTLE_VALKEY_URL: '' }));
    expect(() => opts.useFactory(null)).not.toThrow();
  });
});

describe('ValkeyThrottlerStorage.increment', () => {
  function makeClient(status: 'ready' | 'connecting' | 'reconnecting' = 'ready') {
    // Minimal mock of the parts of ioredis Redis we exercise:
    // defineCommand registers a named command (the Lua script).
    // We intercept the registered command and record calls.
    const calls: Array<{ cmd: string; args: unknown[] }> = [];
    let registeredHandler: ((...args: unknown[]) => Promise<unknown>) | undefined;
    return {
      status,
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

  it('fails open when client.status is not ready', async () => {
    const client = { ...makeClient(), status: 'connecting' as const };
    const storage = new ValkeyThrottlerStorage(client as never);
    const r = await storage.increment('k', 60_000, 5, 60_000, 'auth');
    expect(r).toEqual({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
    expect(client.__calls).toHaveLength(0);
  });

  it('fails open when the Lua script throws (Valkey unreachable mid-call)', async () => {
    const client = makeClient();
    client.__setHandler(() => Promise.reject(new Error('connection lost')));
    const storage = new ValkeyThrottlerStorage(client as never);
    const r = await storage.increment('k', 60_000, 5, 60_000, 'auth');
    expect(r).toEqual({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
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

  it('isAuthRoute is case-insensitive', () => {
    // Defensive: a misconfigured upstream proxy shouldn't bypass the
    // throttler by capitalizing the path.
    expect(__testing__.isAuthRoute({ url: '/Auth/Sign-In' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/Health' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/METRICS' })).toBe(true);
  });

  it('isProbeRoute matches /health and /metrics exactly', () => {
    expect(__testing__.isProbeRoute({ url: '/health' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/metrics' })).toBe(true);
    expect(__testing__.isProbeRoute({ url: '/cities' })).toBe(false);
    expect(__testing__.isProbeRoute({ url: '/healthcheck' })).toBe(false);
  });

  it('isPhoneOtpRoute matches /auth/phone and /auth/phone/*', () => {
    expect(__testing__.isPhoneOtpRoute({ url: '/auth/phone/request' })).toBe(true);
    expect(__testing__.isPhoneOtpRoute({ url: '/auth/phone/verify' })).toBe(true);
    expect(__testing__.isPhoneOtpRoute({ url: '/auth/phone' })).toBe(true);
    expect(__testing__.isPhoneOtpRoute({ url: '/auth/sign-in/email' })).toBe(false);
  });

  it('normalizeIp unwraps IPv6-mapped IPv4 and maps ::1', () => {
    expect(__testing__.normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(__testing__.normalizeIp('::1')).toBe('127.0.0.1');
    expect(__testing__.normalizeIp('2001:db8::1')).toBe('2001:db8::1'); // unchanged
    expect(__testing__.normalizeIp('1.2.3.4')).toBe('1.2.3.4');
  });
});