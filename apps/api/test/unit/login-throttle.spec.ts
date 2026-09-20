// apps/api/test/unit/login-throttle.spec.ts
//
// GH #33 spec-review gap 2 (mirrors phone-otp-throttle.spec.ts):
// the /auth/login route is throttled at 10/min/email via the `login`
// throttler bucket (config in throttler.config.ts, @Throttle override on
// the controller) but no test in the suite exercises the 429 path until
// now. We boot a minimal Nest Fastify app with the REAL ThrottlerModule
// wired against in-memory storage (no Valkey, no Postgres — the throttler
// doesn't touch either). The `login` throttler bucket is per-email, so
// each test uses a fresh email and a fresh throttler state.
//
// Lives in test/unit/ — boots in ~100ms, doesn't touch Docker. Uses the
// same Fastify inject pattern as swagger.spec.ts and phone-otp-throttle
// .spec.ts.

import { APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../../src/audit/audit.service.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { JwtService } from '../../src/auth/jwt.service.js';
import { LoginController } from '../../src/auth/login.controller.js';
import { LoginService } from '../../src/auth/login.service.js';
import { SessionService } from '../../src/auth/session.service.js';
import { DbService } from '../../src/db/db.service.js';
import { buildThrottlerOptions } from '../../src/security/throttler.config.js';

// Minimal Fastify app that wires the REAL ThrottlerModule + REAL
// LoginController. LoginService is stubbed via .overrideProvider because
// we don't want to seed a user / DB. The throttler is still real —
// that's the whole point of this spec.
async function bootApp(): Promise<NestFastifyApplication> {
  const env = {
    THROTTLE_ENABLED: true,
    THROTTLE_TTL_SECONDS: 60,
    THROTTLE_LOGIN_LIMIT: 10,
    THROTTLE_SIGNUP_LIMIT: 3,
    THROTTLE_PASSWORD_RESET_LIMIT: 3,
    THROTTLE_MAGIC_LINK_LIMIT: 5,
    THROTTLE_MFA_LIMIT: 10,
    THROTTLE_DEFAULT_LIMIT: 600,
    THROTTLE_VALKEY_URL: '',
  };
  const throttlerOpts = buildThrottlerOptions(env as never, null);
  if (Array.isArray(throttlerOpts)) throw new Error('expected object form');

  const stubDb = {
    kysely: {},
    runInTenantTx: async (_c: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as DbService;
  const stubAudit = {} as unknown as AuditService;
  const stubJwt = { sign: async () => 'jwt.stub' } as unknown as JwtService;
  const stubAuth = { instance: { api: { signInEmail: vi.fn() } } } as unknown as AuthService;

  // stub LoginService: always succeeds with the canonical shape. The
  // throttler is what we're testing — the controller path is incidental.
  const stubLogin = {
    signInAndIssueSession: vi.fn(async () => ({
      access_token: 'jwt.stub',
      refresh_token: 'jwt.refresh.stub',
      refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      user: {
        id: 'stub',
        handle: 'stub',
        display_name: 'Stub',
        email: 'stub@example.com',
        phone_e164: null,
        avatar_url: null,
        preferred_locale: 'en',
        city_id: null,
        needs_onboarding: true,
        roles: [],
      },
    })),
  } as unknown as LoginService;

  const modRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlerOpts)],
    controllers: [LoginController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: DbService, useValue: stubDb },
      { provide: JwtService, useValue: stubJwt },
      { provide: AuditService, useValue: stubAudit },
      { provide: AuthService, useValue: stubAuth },
      SessionService,
      LoginService,
    ],
  })
    .overrideProvider(LoginService)
    .useValue(stubLogin)
    .compile();

  const app = modRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  return app;
}

interface FastifyInjectResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
}

function getFastify(app: NestFastifyApplication): {
  inject: (req: { method: string; url: string; payload?: unknown }) => Promise<FastifyInjectResponse>;
} {
  return app.getHttpAdapter().getInstance() as unknown as {
    inject: (req: { method: string; url: string; payload?: unknown }) => Promise<FastifyInjectResponse>;
  };
}

// Fastify returns 201 Created by default for POST handlers that don't
// explicitly set a status — the controller does (@HttpCode(200)), so
// happy-path responses are 200.
const POST_OK_STATUS = 200;

describe('POST /auth/login — throttler integration (GH #33 spec gap 2)', () => {
  it('returns 429 on the 11th hit with the same email, with a retry-after header', async () => {
    const app = await bootApp();
    try {
      const fastify = getFastify(app);
      const body = { email: 'a@example.com', password: 'correct-horse-battery-staple' };

      for (let i = 1; i <= 10; i += 1) {
        const r = await fastify.inject({ method: 'POST', url: '/auth/login', payload: body });
        expect(r.statusCode).toBe(POST_OK_STATUS);
      }

      const blocked = await fastify.inject({ method: 'POST', url: '/auth/login', payload: body });
      expect(blocked.statusCode).toBe(429);
      const retryAfter =
        blocked.headers['retry-after-login'] ?? blocked.headers['retry-after'];
      expect(retryAfter, JSON.stringify(blocked.headers)).toBeDefined();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('different email resets the bucket — no 429 across emails', async () => {
    const app = await bootApp();
    try {
      const fastify = getFastify(app);

      for (let i = 1; i <= 10; i += 1) {
        const r = await fastify.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'a@example.com', password: 'correct-horse-battery-staple' },
        });
        expect(r.statusCode).toBe(POST_OK_STATUS);
      }
      const blockedA = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'a@example.com', password: 'correct-horse-battery-staple' },
      });
      expect(blockedA.statusCode).toBe(429);

      // Email B starts fresh.
      const rB = await fastify.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'b@example.com', password: 'correct-horse-battery-staple' },
      });
      expect(rB.statusCode).toBe(POST_OK_STATUS);
    } finally {
      await app.close();
    }
  });

  it('the limit is the real 10/min/email, not a test constant — 21 hits → 10 OK then 11 blocked', async () => {
    // ponytail: distinguishes a real 10/min/email limit from a hard-coded
    // constant. If the real limit were raised to 100, statuses[20] would
    // be 200 and the assertion below would fail.
    const app = await bootApp();
    try {
      const fastify = getFastify(app);
      const email = 'c@example.com';
      const statuses: number[] = [];
      for (let i = 1; i <= 21; i += 1) {
        const r = await fastify.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'correct-horse-battery-staple' },
        });
        statuses.push(r.statusCode);
      }
      const ok10 = Array(10).fill(POST_OK_STATUS);
      expect(statuses).toEqual([...ok10, ...Array(11).fill(429)]);
    } finally {
      await app.close();
    }
  });
});
