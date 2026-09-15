import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { MagicLinkController } from '../../src/auth/magic-link.controller.js';
import { MAILER, type Mailer, MagicLinkService } from '../../src/auth/magic-link.service.js';
import { __testing__, getMagicLinkTracker } from '../../src/security/throttler.config.js';

// ============================================================================
// Test doubles
// ============================================================================

interface MagicLinkRow {
  id: string;
  email: string;
  token: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

interface DbState {
  rows: MagicLinkRow[];
  // When set, lookup always returns null — exercises non-existent token.
  returnNull?: boolean;
}

/**
 * Minimal Kysely-shaped stub. The service uses the 3-arg `.where(col, op, val)`
 * form (which the real Kysely translates to parameterized SQL); the stub
 * just passes the value through. Closures keep token-lookup in one place.
 */
function makeDb(state: DbState) {
  const lookup = async (token: string): Promise<MagicLinkRow | null> => {
    if (state.returnNull) return null;
    return state.rows.find((r) => r.token === token) ?? null;
  };
  return {
    kysely: {
      insertInto: (_table: unknown) => ({
        values: (v: Partial<MagicLinkRow>) => ({
          execute: async () => {
            // Service inserts only the 3 write-side fields; the stub
            // fills in the rest so the lookup shape matches the
            // consumed_at/created_at/id selectors.
            state.rows.push({
              id: '00000000-0000-0000-0000-000000000001',
              email: '',
              token: '',
              expires_at: FUTURE(),
              consumed_at: null,
              created_at: new Date(),
              ...v,
            });
          },
        }),
      }),
      selectFrom: (_table: unknown) => ({
        select: (_cols: unknown) => ({
          where: (_col: unknown, _op: unknown, token: string) => ({
            executeTakeFirst: () => lookup(token),
          }),
        }),
      }),
      updateTable: (_table: unknown) => ({
        set: (patch: Partial<MagicLinkRow>) => ({
          where: (_col: unknown, _op: unknown, token: string) => ({
            execute: async () => {
              const row = state.rows.find((r) => r.token === token);
              if (row) Object.assign(row, patch);
            },
          }),
        }),
      }),
    },
  };
}

function makeMailer() {
  const calls: Array<{ to: string; subject: string; body: string }> = [];
  const mailer: Mailer & { calls: typeof calls } = {
    calls,
    async send(to, subject, body) {
      calls.push({ to, subject, body });
    },
  };
  return mailer;
}

// Tokens must be >= 20 chars to satisfy the controller's VerifyBody zod
// schema. Length 24 is the smallest practical fix; 64 mirrors production
// (two UUIDs concatenated — see magic-link.service.ts).
const VALID_TOKEN = 'a'.repeat(24);

const FUTURE = () => new Date(Date.now() + 15 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60_000);

function configStub(overrides: { MAGIC_LINK_BASE_URL?: string } = {}) {
  return {
    env: {
      MAGIC_LINK_BASE_URL: overrides.MAGIC_LINK_BASE_URL ?? 'https://api.quart.app',
    },
  } as never;
}

function makeRow(overrides: Partial<MagicLinkRow> = {}): MagicLinkRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    // zod 3.24's `.email()` rejects 1-char TLDs. Use a 2+ char TLD so
    // every test here is checking service/controller logic, not zod's
    // email regex.
    email: 'a@example.com',
    token: VALID_TOKEN,
    expires_at: FUTURE(),
    consumed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Service
// ============================================================================

describe('MagicLinkService', () => {
  it('issue writes a row and emails a verify URL', async () => {
    const state: DbState = { rows: [] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);

    const { token, expiresAt } = await svc.issue('a@example.com');

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row.email).toBe('a@example.com');
    expect(row.token).toBe(token);
    expect(row.expires_at.getTime()).toBe(expiresAt.getTime());

    expect(mailer.calls).toHaveLength(1);
    const call = mailer.calls[0]!;
    expect(call.to).toBe('a@example.com');
    expect(call.subject.length).toBeGreaterThan(0);
    expect(call.body).toContain(`https://api.quart.app/auth/magic-link/verify?token=${token}`);
  });

  it('issue uses MAGIC_LINK_BASE_URL from config (env override)', async () => {
    const state: DbState = { rows: [] };
    const mailer = makeMailer();
    const db = makeDb(state);
    const svc = new MagicLinkService(
      db as never,
      configStub({ MAGIC_LINK_BASE_URL: 'https://staging.quart.app' }),
      mailer,
    );

    const { token } = await svc.issue('user@example.com');
    expect(mailer.calls[0]!.body).toContain(
      `https://staging.quart.app/auth/magic-link/verify?token=${token}`,
    );
  });

  it('issue generates a fresh token each call (no reuse across requests)', async () => {
    const state: DbState = { rows: [] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);

    const a = await svc.issue('a@example.com');
    const b = await svc.issue('a@example.com');
    expect(a.token).not.toBe(b.token);
    expect(state.rows).toHaveLength(2);
  });

  it('generated token is at least 60 chars (CSPRNG floor)', async () => {
    const state: DbState = { rows: [] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);
    const { token } = await svc.issue('a@example.com');
    // Two UUIDs (36 + 32 = 68 chars).
    expect(token.length).toBeGreaterThanOrEqual(60);
  });

  it('consume returns the email on a valid, unused token', async () => {
    const state: DbState = { rows: [makeRow()] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);
    const r = await svc.consume(VALID_TOKEN);
    expect(r).toEqual({ email: 'a@example.com' });
    expect(state.rows[0]!.consumed_at).not.toBeNull();
  });

  it('consume returns null when the token has already been used', async () => {
    const state: DbState = { rows: [makeRow({ consumed_at: new Date() })] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);
    expect(await svc.consume(VALID_TOKEN)).toBeNull();
  });

  it('consume returns null for an expired token', async () => {
    const state: DbState = { rows: [makeRow({ expires_at: PAST() })] };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);
    expect(await svc.consume(VALID_TOKEN)).toBeNull();
  });

  it('consume returns null for a non-existent token (no leak)', async () => {
    const state: DbState = { rows: [], returnNull: true };
    const db = makeDb(state);
    const mailer = makeMailer();
    const svc = new MagicLinkService(db as never, configStub(), mailer);
    expect(await svc.consume('nonexistent')).toBeNull();
  });
});

// ============================================================================
// Controller
// ============================================================================

describe('MagicLinkController', () => {
  it('request proxies to service.issue', async () => {
    const state: DbState = { rows: [] };
    const mailer = makeMailer();
    const svc = new MagicLinkService(makeDb(state) as never, configStub(), mailer);
    const c = new MagicLinkController(svc as never);

    const r = await c.request({ email: 'a@example.com' });
    expect(r).toEqual({ sent: true });
    expect(mailer.calls).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
  });

  it('request rejects a non-email body', async () => {
    const mailer = makeMailer();
    const svc = new MagicLinkService(
      makeDb({ rows: [] }) as never,
      configStub(),
      mailer,
    );
    const c = new MagicLinkController(svc as never);
    await expect(c.request({ email: 'not-an-email' })).rejects.toThrow();
    expect(mailer.calls).toHaveLength(0);
  });

  it('verify returns { ok: true, email } on a valid token', async () => {
    const state: DbState = { rows: [makeRow()] };
    const mailer = makeMailer();
    const svc = new MagicLinkService(makeDb(state) as never, configStub(), mailer);
    const c = new MagicLinkController(svc as never);
    expect(await c.verify({ token: VALID_TOKEN })).toEqual({ ok: true, email: 'a@example.com' });
  });

  it('verify returns { ok: false } on every failure mode (no leak)', async () => {
    const cases = [
      ['already consumed', makeRow({ consumed_at: new Date() })],
      ['expired', makeRow({ expires_at: PAST() })],
      ['non-existent', null],
    ] as const;
    for (const [label, row] of cases) {
      const state: DbState = row ? { rows: [row] } : { rows: [], returnNull: true };
      const svc = new MagicLinkService(makeDb(state) as never, configStub(), makeMailer());
      const c = new MagicLinkController(svc as never);
      expect(await c.verify({ token: VALID_TOKEN }), label).toEqual({ ok: false });
    }
  });

  it('verify rejects tokens outside the [20, 128] length band', async () => {
    const svc = new MagicLinkService(
      makeDb({ rows: [] }) as never,
      configStub(),
      makeMailer(),
    );
    const c = new MagicLinkController(svc as never);
    await expect(c.verify({ token: 'short' })).rejects.toThrow();
    await expect(c.verify({ token: 'x'.repeat(200) })).rejects.toThrow();
  });

  it('issuing twice does not invalidate the prior token', async () => {
    const state: DbState = { rows: [] };
    const svc = new MagicLinkService(makeDb(state) as never, configStub(), makeMailer());
    const c = new MagicLinkController(svc as never);

    await c.request({ email: 'a@example.com' });
    await c.request({ email: 'a@example.com' });

    expect(state.rows).toHaveLength(2);
    // The first token is still consumable — re-request does NOT invalidate it.
    const firstToken = state.rows[0]!.token;
    expect(await c.verify({ token: firstToken })).toEqual({ ok: true, email: 'a@example.com' });
  });

  it('request + verify + re-verify: second verify fails (single-use)', async () => {
    const state: DbState = { rows: [] };
    const svc = new MagicLinkService(makeDb(state) as never, configStub(), makeMailer());
    const c = new MagicLinkController(svc as never);

    await c.request({ email: 'a@example.com' });
    const token = state.rows[0]!.token;

    expect(await c.verify({ token })).toEqual({ ok: true, email: 'a@example.com' });
    expect(await c.verify({ token })).toEqual({ ok: false });
  });
});

// ============================================================================
// Throttler routing helpers
// ============================================================================

describe('getMagicLinkTracker', () => {
  it('keys on req.body.email (lowercased)', () => {
    expect(getMagicLinkTracker({ ip: '1.2.3.4', body: { email: 'A@B.COM' } })).toBe('email:a@b.com');
  });

  it('falls back to ip when body is missing email', () => {
    expect(getMagicLinkTracker({ ip: '5.6.7.8' })).toBe('ip:5.6.7.8');
    expect(getMagicLinkTracker({ ip: '5.6.7.8', body: {} })).toBe('ip:5.6.7.8');
    expect(getMagicLinkTracker({ ip: '5.6.7.8', body: { email: '' } })).toBe('ip:5.6.7.8');
  });

  it('falls back to ip:unknown when neither body nor ip is present', () => {
    expect(getMagicLinkTracker({ body: {} })).toBe('ip:unknown');
    expect(getMagicLinkTracker({})).toBe('ip:unknown');
  });
});

describe('isMagicLinkRoute', () => {
  it('matches /auth/magic-link/request only', () => {
    expect(__testing__.isMagicLinkRoute({ url: '/auth/magic-link/request' })).toBe(true);
    // Verify is intentionally NOT in the per-email bucket — it's key-search
    // bounded by 256-bit tokens, not by enumeration.
    expect(__testing__.isMagicLinkRoute({ url: '/auth/magic-link/verify' })).toBe(false);
    expect(__testing__.isMagicLinkRoute({ url: '/auth/mfa' })).toBe(false);
  });
});

// ============================================================================
// MAILER DI wiring
// ============================================================================

describe('MAILER DI token', () => {
  it('module compiles when MAILER is provided (catch rename regressions)', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        { provide: MAILER, useValue: makeMailer() },
      ],
    }).compile();
    const mailer = mod.get(MAILER);
    expect(typeof mailer.send).toBe('function');
    await mod.close();
  });
});

// ============================================================================
// @Throttle decorator wiring on MagicLinkController.request
// ============================================================================
//
// Behavioral rate-limit verification lives in test/integration (Docker +
// Valkey) and the live e2e harness. For the unit suite we prove two
// things:
//   (a) the @Throttle decorator attaches both `auth` and `magiclink`
//       bucket descriptors to the handler, and
//   (b) the metadata carries the spec-required limits (10/60s each).
//
// Full request-trip-the-throttler coverage is in T44's integration
// suite and the e2e harness.

describe('MagicLink @Throttle decorator wiring', () => {
  it('request() carries both auth and magiclink buckets at 10/60s', () => {
    // @nestjs/throttler@6 emits metadata keys as
    // `THROTTLER:LIMIT{::name}` (no separator — string concat is the
    // implementation detail in throttler.decorator.js). Metadata lands
    // on `descriptor.value`, which is the method function reference on
    // the prototype.
    const fn = MagicLinkController.prototype.request as unknown as object;
    const authLimit = Reflect.getMetadata('THROTTLER:LIMITauth', fn);
    const authTtl = Reflect.getMetadata('THROTTLER:TTLauth', fn);
    const mlLimit = Reflect.getMetadata('THROTTLER:LIMITmagiclink', fn);
    const mlTtl = Reflect.getMetadata('THROTTLER:TTLmagiclink', fn);

    expect(authLimit).toBe(10);
    expect(authTtl).toBe(60_000);
    expect(mlLimit).toBe(10);
    expect(mlTtl).toBe(60_000);
  });
});
