// apps/api/test/unit/phone-otp-throttle.spec.ts
//
// GH #30 spec-review gap 2: the /auth/phone/verify route is throttled at
// 5/min/phone (config in throttler.config.ts, @Throttle override on the
// controller) but no test in the suite actually exercises the 429 path.
// The throttler config is unit-tested in throttler.spec.ts (limit=5, tracker
// reads req.body.phoneNumber, etc.) — what's missing is an end-to-end
// proof that hitting the route 6 times with the same phoneNumber actually
// returns 429 with the canonical `Retry-After` header.
//
// We boot a minimal Nest Fastify app with the REAL ThrottlerModule wired
// against in-memory storage (no Valkey, no Postgres — the throttler
// doesn't touch either). The `phone` throttler bucket is per-phone, so
// each test uses a fresh phoneNumber and a fresh throttler state.
//
// Lives in test/unit/ — boots in ~100ms, doesn't touch Docker. The spec
// uses the same Fastify inject pattern as swagger.spec.ts.

import { APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../../src/audit/audit.service.js';
import { PhoneOtpController } from '../../src/auth/phone-otp.controller.js';
import { PhoneOtpService } from '../../src/auth/phone-otp.service.js';
import { SessionService } from '../../src/auth/session.service.js';
import { TwilioService } from '../../src/auth/twilio.service.js';
import { DbService } from '../../src/db/db.service.js';
import { buildThrottlerOptions } from '../../src/security/throttler.config.js';

// Minimal Fastify app that wires the REAL ThrottlerModule + REAL
// PhoneOtpController. PhoneOtpService is stubbed via .overrideProvider
// because we don't want to seed a user / DB. The throttler is still
// real — that's the whole point of this spec.
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
  // No Valkey instance → throttler falls back to in-memory storage.
  const throttlerOpts = buildThrottlerOptions(env as never, null);
  if (Array.isArray(throttlerOpts)) throw new Error('expected object form');

  const stubDb = {
    kysely: {},
    runInTenantTx: async (_c: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
  } as unknown as DbService;
  const stubAudit = {} as unknown as AuditService;
  const stubTwilio = { verifyOtp: vi.fn(async () => true), sendOtp: vi.fn() } as unknown as TwilioService;

  // stub PhoneOtpService: always returns a successful session response.
  // The throttler is what we're testing — the controller path is incidental.
  // GH #45: no access_token — BA owns the bearer, so the response is just
  // the Quart user projection.
  const stubPhoneOtp = {
    verifyAndIssueSession: vi.fn(async () => ({
      user: {
        id: 'user-stub',
        handle: 'stub',
        display_name: 'Stub',
        email: null,
        phone_e164: '+15555550100',
        avatar_url: null,
        preferred_locale: 'en',
        city_id: null,
        needs_onboarding: true,
        roles: [],
      },
    })),
  } as unknown as PhoneOtpService;

  const modRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot(throttlerOpts)],
    controllers: [PhoneOtpController],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: DbService, useValue: stubDb },
      { provide: AuditService, useValue: stubAudit },
      { provide: TwilioService, useValue: stubTwilio },
      SessionService,
      PhoneOtpService,
    ],
  })
    .overrideProvider(PhoneOtpService)
    .useValue(stubPhoneOtp)
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
// explicitly set a status — the controller doesn't, so we test against
// 201 for the happy path. (The throttler test is about the 429 path;
// the 201 just proves we reached the route and not the throttler.)
const POST_OK_STATUS = 201;

describe('POST /auth/phone/verify — throttler integration (GH #30 spec gap 2)', () => {
  it('returns 429 on the 6th hit with the same phoneNumber, with a retry-after header', async () => {
    const app = await bootApp();
    try {
      const fastify = getFastify(app);
      const body = { phoneNumber: '+15551234999', code: '123456' };

      // First 5 hits → POST_OK_STATUS — proves we exercised the actual
      // route, not the throttler rejecting on a misrouted URL.
      for (let i = 1; i <= 5; i += 1) {
        const r = await fastify.inject({ method: 'POST', url: '/auth/phone/verify', payload: body });
        expect(r.statusCode).toBe(POST_OK_STATUS);
      }

      // 6th hit → 429 from the `phone` throttler bucket. The throttler
      // emits a per-bucket `Retry-After-<name>` header (see
      // throttler.guard.js:117-118 in @nestjs/throttler) — for the phone
      // bucket that's `Retry-After-Phone`. Fastify normalises header
      // names to lowercase + hyphen, so we look for `retry-after-phone`.
      const blocked = await fastify.inject({ method: 'POST', url: '/auth/phone/verify', payload: body });
      expect(blocked.statusCode).toBe(429);
      const retryAfter =
        blocked.headers['retry-after-phone'] ?? blocked.headers['retry-after'];
      expect(retryAfter, JSON.stringify(blocked.headers)).toBeDefined();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('different phoneNumber resets the bucket — no 429 across phones', async () => {
    // Per-phone isolation is the whole point of the `phone` bucket: an
    // attacker iterating phones from one IP can't multiply the budget.
    const app = await bootApp();
    try {
      const fastify = getFastify(app);

      // Burn phone A's bucket.
      for (let i = 1; i <= 5; i += 1) {
        const r = await fastify.inject({
          method: 'POST',
          url: '/auth/phone/verify',
          payload: { phoneNumber: '+15551234001', code: '123456' },
        });
        expect(r.statusCode).toBe(POST_OK_STATUS);
      }
      const blockedA = await fastify.inject({
        method: 'POST',
        url: '/auth/phone/verify',
        payload: { phoneNumber: '+15551234001', code: '123456' },
      });
      expect(blockedA.statusCode).toBe(429);

      // Phone B starts fresh — its 1st hit is still POST_OK_STATUS.
      const rB = await fastify.inject({
        method: 'POST',
        url: '/auth/phone/verify',
        payload: { phoneNumber: '+15551234002', code: '123456' },
      });
      expect(rB.statusCode).toBe(POST_OK_STATUS);
    } finally {
      await app.close();
    }
  });

  it('the limit is the real 5/min/phone, not a test constant — 11 hits → 5 OK then 6 blocked', async () => {
    // ponytail: this test distinguishes a real 5/min/phone limit from
    // a hard-coded constant. Raising the real limit to 100 would let
    // 11 calls through; we hit 11 times so any limit >= 6 yields all
    // 2xx and the assertion fails. The on-controller @Throttle({ phone:
    // { limit: 5 } }) AND the global `phone` throttler config both
    // agree on 5, so a refactor that bumps either one surfaces here.
    const app = await bootApp();
    try {
      const fastify = getFastify(app);
      const phone = '+15551234998';
      const statuses: number[] = [];
      for (let i = 1; i <= 11; i += 1) {
        const r = await fastify.inject({
          method: 'POST',
          url: '/auth/phone/verify',
          payload: { phoneNumber: phone, code: '123456' },
        });
        statuses.push(r.statusCode);
      }
      // 5 OK, then 6 blocked. If the real limit were raised to 100,
      // the assertion below would fail (statuses[10] would be 201).
      expect(statuses).toEqual([
        POST_OK_STATUS, POST_OK_STATUS, POST_OK_STATUS, POST_OK_STATUS, POST_OK_STATUS,
        429, 429, 429, 429, 429, 429,
      ]);
    } finally {
      await app.close();
    }
  });
});
