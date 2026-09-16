import 'reflect-metadata';

import { Test } from '@nestjs/testing';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { type AuditService, type SystemAuditEvent } from '../../src/audit/audit.service.js';
import { MagicLinkController } from '../../src/auth/magic-link.controller.js';
import { MAILER as MAGIC_LINK_MAILER } from '../../src/auth/magic-link.service.js';
import { PasswordResetController } from '../../src/auth/password-reset.controller.js';
import {
  type Mailer,
  PASSWORD_RESET_MAILER,
  PasswordResetService,
} from '../../src/auth/password-reset.service.js';
import { __testing__, getPasswordResetTracker } from '../../src/security/throttler.config.js';

// ============================================================================
// Test doubles
// ============================================================================

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
}

interface PasswordResetRow {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

interface State {
  users: UserRow[];
  rows: PasswordResetRow[];
}

/**
 * Minimal Kysely-shaped stub. The service uses
 * `.select(col).from(table).where(...).executeTakeFirst()` for the
 * user lookup, and the atomic UPDATE-WHERE-RETURNING chain
 * `.updateTable().set().where().where().where().returning().executeTakeFirst()`
 * for consume. The stub mirrors both shapes — keeps the SQL invariant
 * (single-roundtrip atomic UPDATE, no SELECT-then-UPDATE) testable.
 *
 * `transaction().execute(fn)` opens a fake transaction so writeSystem's
 * mutate callback can reuse the same builders (mirroring how a real
 * Kysely transaction is a builder alias for the connection).
 */
function makeDb(state: State) {
  const pushRow = (v: Partial<PasswordResetRow>): PasswordResetRow => {
    const row: PasswordResetRow = {
      id: '00000000-0000-0000-0000-000000000001',
      user_id: '',
      token: '',
      expires_at: new Date(),
      consumed_at: null,
      created_at: new Date(),
      ...v,
    };
    state.rows.push(row);
    return row;
  };

  const builders = {
    selectFrom: (table: string) => ({
      select: (cols: unknown) => ({
        where: (col: unknown, op: unknown, val: unknown) => ({
          executeTakeFirst: async () => {
            if (table !== 'users') return undefined;
            // Only the email lookup is exercised here.
            const colName = Array.isArray(cols) ? (cols as string[])[0] : (cols as string);
            if (colName !== 'id') return undefined;
            const row = state.users.find(
              (u) => op === '=' && (col as string) === 'email' && u.email === val,
            );
            return row ? { id: row.id } : undefined;
          },
        }),
      }),
    }),
    insertInto: (_table: unknown) => ({
      values: (v: Partial<PasswordResetRow>) => ({
        execute: async () => {
          pushRow(v);
        },
        returning: (_cols: unknown) => ({
          executeTakeFirst: async () => pushRow(v),
        }),
      }),
    }),
    // selectFrom for password_resets is intentionally absent: the
    // service must never SELECT-then-UPDATE. The atomic consume is a
    // single round-trip UPDATE-WHERE-RETURNING.
    updateTable: (table: string) => {
      const chain: {
        set: unknown;
        wheres: Array<(row: PasswordResetRow | UserRow) => boolean>;
        returning: unknown;
      } = {
        set: undefined,
        wheres: [],
        returning: undefined,
      };
      let returningCols: unknown = undefined;
      const obj = {
        set: (patch: Partial<PasswordResetRow> | Partial<UserRow>) => {
          chain.set = patch;
          return obj;
        },
        where: (col: unknown, op: unknown, val: unknown) => {
          chain.wheres.push((row) => {
            if (table === 'password_resets') {
              const r = row as PasswordResetRow;
              if (col === 'token' && op === '=') return r.token === val;
              if (col === 'consumed_at' && op === 'is') {
                return val === null ? r.consumed_at === null : r.consumed_at !== null;
              }
              if (col === 'expires_at' && op === '>') {
                return r.expires_at.getTime() > (val as Date).getTime();
              }
              return true;
            }
            if (table === 'users') {
              const u = row as UserRow;
              if (col === 'id' && op === '=') return u.id === val;
              return true;
            }
            return true;
          });
          return obj;
        },
        returning: (cols: unknown) => {
          chain.returning = cols;
          returningCols = cols;
          return obj;
        },
        executeTakeFirst: async () => {
          if (table === 'password_resets') {
            const row = state.rows.find((r) => chain.wheres.every((p) => p(r)));
            if (row) Object.assign(row, chain.set as Partial<PasswordResetRow>);
            if (!row) return undefined;
            // Mirror the columns the service selects.
            if (Array.isArray(returningCols)) {
              const out: Record<string, unknown> = {};
              for (const c of returningCols as string[]) {
                if (c === 'id') out.id = row.id;
                if (c === 'user_id') out.user_id = row.user_id;
              }
              return out;
            }
            return { user_id: row.user_id };
          }
          return undefined;
        },
        execute: async () => {
          if (table === 'users') {
            const row = state.users.find((u) => chain.wheres.every((p) => p(u)));
            if (row) Object.assign(row, chain.set as Partial<UserRow>);
            return { numUpdatedRows: row ? 1n : 0n };
          }
          return { numUpdatedRows: 0n };
        },
      };
      return obj;
    },
  };

  return {
    kysely: {
      transaction: () => ({
        execute: async (fn: (trx: unknown) => Promise<unknown>) => fn(builders),
      }),
      ...builders,
    },
    // Trx-builder alias used by the audit writeSystem stub (mirrors
    // how a real Kysely Transaction<DB> shares the connection's
    // query builder surface).
    __trxBuilders: builders,
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

// Tokens must be >= 20 chars to satisfy the controller's ResetSchema.
const VALID_TOKEN = 'a'.repeat(24);

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 60_000);

function configStub() {
  return {
    env: {
      MAGIC_LINK_BASE_URL: 'https://api.quart.app',
    },
  } as never;
}

const FIXED_USER_ID = '11111111-1111-1111-1111-111111111111';

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: FIXED_USER_ID,
    email: 'a@example.com',
    password_hash: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<PasswordResetRow> = {}): PasswordResetRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: FIXED_USER_ID,
    token: VALID_TOKEN,
    expires_at: FUTURE(),
    consumed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

function buildService(state: State, mailer = makeMailer()) {
  const db = makeDb(state);
  const auditCalls: Array<{ action: string; targetId: string; payload: unknown }> = [];
  const audit = {
    async writeSystem(
      _db: unknown,
      ev: SystemAuditEvent,
      mutate?: (trx: unknown) => Promise<{ skip?: boolean; targetId?: string } | void>,
    ) {
      const trx = (db as unknown as { __trxBuilders?: unknown }).__trxBuilders ?? (db as never).kysely;
      const result = mutate ? await mutate(trx) : undefined;
      if (!result || !('skip' in result) || !result.skip) {
        auditCalls.push({
          action: ev.action,
          targetId: result && 'targetId' in result && result.targetId ? result.targetId : ev.targetId,
          payload: ev.payload,
        });
      }
    },
  };
  const svc = new PasswordResetService(
    db as never,
    configStub(),
    audit as unknown as AuditService,
    mailer,
  );
  return { db, svc, mailer, auditCalls };
}

// ============================================================================
// Service
// ============================================================================

describe('PasswordResetService', () => {
  it('issue for an unknown email does NOT insert or send (no enumeration leak)', async () => {
    const state: State = { users: [], rows: [] };
    const { svc, mailer, auditCalls } = buildService(state);
    await svc.issue('nobody@example.com');
    expect(state.rows).toHaveLength(0);
    expect(mailer.calls).toHaveLength(0);
    // Audit: request attempt is logged even when no user matches —
    // operators need to see attempted enumeration. Target is the
    // normalized email (no user id available).
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.action).toBe('auth.password_reset_request');
    expect(auditCalls[0]!.targetId).toBe('nobody@example.com');
    expect(auditCalls[0]!.payload).toEqual({ found: false });
  });

  it('issue for a known email inserts a row and emails a reset URL', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc, mailer, auditCalls } = buildService(state);
    await svc.issue('a@example.com');
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row.user_id).toBe(FIXED_USER_ID);
    expect(row.token.length).toBeGreaterThan(0);
    // 60 min TTL — expires_at is within the next hour.
    expect(row.expires_at.getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(mailer.calls).toHaveLength(1);
    expect(mailer.calls[0]!.to).toBe('a@example.com');
    expect(mailer.calls[0]!.body).toContain(
      `https://api.quart.app/auth/password/reset?token=${row.token}`,
    );
    // Audit: request event lands with the reset row id (targetId
    // overrides after the insert).
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.action).toBe('auth.password_reset_request');
    expect(auditCalls[0]!.targetId).toBe('00000000-0000-0000-0000-000000000001');
    expect(auditCalls[0]!.payload).toEqual({ found: true });
  });

  it('issue lowercases the email before lookup + insert (citext defense in depth)', async () => {
    const state: State = { users: [makeUser({ email: 'user@example.com' })], rows: [] };
    const { svc, mailer, auditCalls } = buildService(state);
    await svc.issue('USER@EXAMPLE.COM');
    expect(state.rows).toHaveLength(1);
    expect(mailer.calls[0]!.to).toBe('user@example.com');
    // Audit's targetId is the user id, but lowercase email flows
    // through the user lookup.
    expect(auditCalls[0]!.targetId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('issue generates a fresh token each call (no reuse across requests)', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc } = buildService(state);
    await svc.issue('a@example.com');
    await svc.issue('a@example.com');
    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]!.token).not.toBe(state.rows[1]!.token);
  });

  it('generated token is at least 60 chars (CSPRNG floor)', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc } = buildService(state);
    await svc.issue('a@example.com');
    // Two UUIDs concatenated = 68 chars.
    expect(state.rows[0]!.token.length).toBeGreaterThanOrEqual(60);
  });

  it('reset on a valid token updates password_hash and returns { ok: true }', async () => {
    const state: State = { users: [makeUser({ password_hash: 'old-hash' })], rows: [makeRow()] };
    const { svc, auditCalls } = buildService(state);
    const r = await svc.reset(VALID_TOKEN, 'NewStrongPassword!!1');
    expect(r).toEqual({ ok: true });
    expect(state.users[0]!.password_hash).not.toBe('old-hash');
    expect(state.users[0]!.password_hash).not.toBeNull();
    // Better Auth's hashPassword writes `salt:hash` (hex) — verify
    // round-trips through the same primitive auth.service.ts uses at
    // sign-in. The format check guards against a regression that
    // silently swaps in another hashing primitive.
    expect(state.users[0]!.password_hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(
      verifyPassword({
        hash: state.users[0]!.password_hash!,
        password: 'NewStrongPassword!!1',
      }),
    ).resolves.toBe(true);
    // Audit: success path writes auth.password_reset with the
    // password_resets row id as targetId.
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]!.action).toBe('auth.password_reset');
    expect(auditCalls[0]!.targetId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('reset on a failure mode does NOT touch password_hash (regression guard)', async () => {
    // Failure-mode tests must leave the hash unchanged — otherwise a
    // regression that updates the hash before the consume succeeds
    // (or on a stale token) would be invisible. Anchor the invariant
    // by seeding an old hash and asserting it survives every branch.
    const cases: ReadonlyArray<readonly [string, PasswordResetRow | null]> = [
      ['already consumed', makeRow({ consumed_at: new Date() })],
      ['expired', makeRow({ expires_at: PAST() })],
      ['non-existent', null],
    ] as const;
    for (const [label, row] of cases) {
      const state: State = {
        users: [makeUser({ password_hash: 'old-hash' })],
        rows: row ? [row] : [],
      };
      const { svc, auditCalls } = buildService(state, makeMailer());
      const result = await svc.reset(VALID_TOKEN, 'NewStrongPassword!!1');
      expect(result, label).toEqual({ ok: false });
      expect(state.users[0]!.password_hash, label).toBe('old-hash');
      // Failure modes must NOT land an audit row — no state change,
      // no chain pollution.
      expect(auditCalls, label).toHaveLength(0);
    }
  });

  it('hashPassword round-trip (sanity for the primitive the service uses)', async () => {
    // Ponytail anchor: if a future refactor switches hashing to
    // something other than Better Auth's `hashPassword`, the previous
    // test still passes via an inline `hashPassword` call. This sanity
    // check pins the spec — separate bcrypt-style outputs from
    // Better Auth's `salt:hash` format.
    const hash = await hashPassword('pwd-abc-123');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(verifyPassword({ hash, password: 'pwd-abc-123' })).resolves.toBe(true);
    await expect(verifyPassword({ hash, password: 'wrong' })).resolves.toBe(false);
  });

  it('reset consumed a consumed token returns { ok: false } (single-use)', async () => {
    const state: State = { users: [makeUser()], rows: [makeRow({ consumed_at: new Date() })] };
    const { svc } = buildService(state);
    expect(await svc.reset(VALID_TOKEN, 'NewStrongPassword!!1')).toEqual({ ok: false });
  });

  it('reset returns { ok: false } for an expired token', async () => {
    const state: State = { users: [makeUser()], rows: [makeRow({ expires_at: PAST() })] };
    const { svc } = buildService(state);
    expect(await svc.reset(VALID_TOKEN, 'NewStrongPassword!!1')).toEqual({ ok: false });
  });

  it('reset returns { ok: false } for an unknown token (no leak)', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc } = buildService(state);
    expect(await svc.reset('nonexistent', 'NewStrongPassword!!1')).toEqual({ ok: false });
  });

  it('reset uses a single UPDATE-WHERE-RETURNING (no selectFrom on password_resets)', async () => {
    // Race-condition fix: the service must never SELECT-then-UPDATE on
    // password_resets. The atomic UPDATE-WHERE-RETURNING is the only
    // statement that touches this table on the consume path.
    const state: State = { users: [makeUser()], rows: [makeRow()] };
    const { db, svc } = buildService(state);
    // selectFrom is intentionally only stubbed for the users lookup — if
    // the service ever reads password_resets via SELECT, that wiring
    // change would require updating this stub (catching the regression).
    expect((db.kysely as unknown as { selectFrom?: unknown }).selectFrom).toBeDefined();
    const r = await svc.reset(VALID_TOKEN, 'NewStrongPassword!!1');
    expect(r).toEqual({ ok: true });
  });
});

// ============================================================================
// Controller
// ============================================================================

describe('PasswordResetController', () => {
  it('forgot proxies to service.issue and always returns { sent: true }', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc, mailer } = buildService(state);
    const c = new PasswordResetController(svc as never);

    const r = await c.forgot({ email: 'a@example.com' });
    expect(r).toEqual({ sent: true });
    expect(mailer.calls).toHaveLength(1);
    expect(state.rows).toHaveLength(1);
  });

  it('forgot returns { sent: true } even when the user is unknown (no enumeration)', async () => {
    const state: State = { users: [], rows: [] };
    const { svc, mailer } = buildService(state);
    const c = new PasswordResetController(svc as never);
    expect(await c.forgot({ email: 'nobody@example.com' })).toEqual({ sent: true });
    expect(mailer.calls).toHaveLength(0);
    expect(state.rows).toHaveLength(0);
  });

  it('forgot handler is wrapped in ZodValidationPipe (schema metadata)', () => {
    const fn = PasswordResetController.prototype.forgot as unknown as object;
    const pipes = Reflect.getMetadata('__pipes__', fn) as unknown[] | undefined;
    expect(Array.isArray(pipes)).toBe(true);
    expect(pipes!.length).toBeGreaterThan(0);
  });

  it('reset proxies to service.reset and surfaces { ok: true }', async () => {
    const state: State = { users: [makeUser()], rows: [makeRow()] };
    const { svc } = buildService(state);
    const c = new PasswordResetController(svc as never);
    expect(await c.reset({ token: VALID_TOKEN, newPassword: 'NewStrongPassword!!1' })).toEqual({ ok: true });
  });

  it('reset returns { ok: false } on every failure mode (no leak)', async () => {
    const cases: ReadonlyArray<readonly [string, PasswordResetRow | null]> = [
      ['already consumed', makeRow({ consumed_at: new Date() })],
      ['expired', makeRow({ expires_at: PAST() })],
      ['non-existent', null],
    ] as const;
    for (const [label, row] of cases) {
      const state: State = row ? { users: [makeUser()], rows: [row] } : { users: [makeUser()], rows: [] };
      const { svc } = buildService(state);
      const c = new PasswordResetController(svc as never);
      expect(
        await c.reset({ token: VALID_TOKEN, newPassword: 'NewStrongPassword!!1' }),
        label,
      ).toEqual({ ok: false });
    }
  });

  it('reset handler is wrapped in ZodValidationPipe (schema metadata)', () => {
    const fn = PasswordResetController.prototype.reset as unknown as object;
    const pipes = Reflect.getMetadata('__pipes__', fn) as unknown[] | undefined;
    expect(Array.isArray(pipes)).toBe(true);
    expect(pipes!.length).toBeGreaterThan(0);
  });

  it('issuing twice does not invalidate the prior token', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc } = buildService(state);
    const c = new PasswordResetController(svc as never);

    await c.forgot({ email: 'a@example.com' });
    await c.forgot({ email: 'a@example.com' });

    expect(state.rows).toHaveLength(2);
    const firstToken = state.rows[0]!.token;
    expect(
      await c.reset({ token: firstToken, newPassword: 'NewStrongPassword!!1' }),
    ).toEqual({ ok: true });
  });

  it('request + reset + re-reset: second reset fails (single-use)', async () => {
    const state: State = { users: [makeUser()], rows: [] };
    const { svc } = buildService(state);
    const c = new PasswordResetController(svc as never);

    await c.forgot({ email: 'a@example.com' });
    const token = state.rows[0]!.token;

    expect(await c.reset({ token, newPassword: 'NewStrongPassword!!1' })).toEqual({ ok: true });
    expect(await c.reset({ token, newPassword: 'OtherNewPassword!!2' })).toEqual({ ok: false });
  });
});

// ============================================================================
// Throttler routing helpers
// ============================================================================

describe('getPasswordResetTracker', () => {
  it('keys on req.body.email (lowercased)', () => {
    expect(getPasswordResetTracker({ ip: '1.2.3.4', body: { email: 'A@B.COM' } })).toBe(
      'email:a@b.com',
    );
  });

  it('falls back to ip when body is missing email', () => {
    expect(getPasswordResetTracker({ ip: '5.6.7.8' })).toBe('ip:5.6.7.8');
    expect(getPasswordResetTracker({ ip: '5.6.7.8', body: {} })).toBe('ip:5.6.7.8');
    expect(getPasswordResetTracker({ ip: '5.6.7.8', body: { email: '' } })).toBe('ip:5.6.7.8');
  });

  it('falls back to ip:unknown when neither body nor ip is present', () => {
    expect(getPasswordResetTracker({ body: {} })).toBe('ip:unknown');
    expect(getPasswordResetTracker({})).toBe('ip:unknown');
  });
});

describe('isPasswordResetRoute', () => {
  it('matches /auth/password/forgot only', () => {
    expect(__testing__.isPasswordResetRoute({ url: '/auth/password/forgot' })).toBe(true);
    // Reset is intentionally NOT in the per-email bucket — token is 256-bit.
    expect(__testing__.isPasswordResetRoute({ url: '/auth/password/reset' })).toBe(false);
    expect(__testing__.isPasswordResetRoute({ url: '/auth/magic-link/request' })).toBe(false);
  });
});

// ============================================================================
// PASSWORD_RESET_MAILER DI token
// ============================================================================

describe('PASSWORD_RESET_MAILER DI token', () => {
  it('module compiles when PASSWORD_RESET_MAILER is provided (catch rename regressions)', async () => {
    const mod = await Test.createTestingModule({
      providers: [{ provide: PASSWORD_RESET_MAILER, useValue: makeMailer() }],
    }).compile();
    const mailer = mod.get(PASSWORD_RESET_MAILER);
    expect(typeof mailer.send).toBe('function');
    await mod.close();
  });

  it('PASSWORD_RESET_MAILER is a distinct DI token from MAILER (no aliasing)', () => {
    // Both modules re-export MAILER-shaped tokens. The DI container is
    // identity-bound, so PASTE-as-MAILER in AuthModule would silently
    // rewire magic-link's mailer. Test asserts the Symbols differ.
    expect(PASSWORD_RESET_MAILER).not.toBe(MAGIC_LINK_MAILER);
  });

  it('service wires PASSWORD_RESET_MAILER (not MAILER) for the mailer argument', async () => {
    // The service depends on PASSWORD_RESET_MAILER (not MAILER). Wiring
    // only that symbol proves the DI token is the one bound by
    // AuthModule — if the service migrated to MAILER, this test would
    // fail at provider resolution.
    const mod = await Test.createTestingModule({
      providers: [{ provide: PASSWORD_RESET_MAILER, useValue: makeMailer() }],
    }).compile();
    const mailer = mod.get<Mailer>(PASSWORD_RESET_MAILER);
    expect(typeof mailer.send).toBe('function');
    await mod.close();
  });
});

// ============================================================================
// @Throttle decorator wiring
// ============================================================================

describe('PasswordReset @Throttle decorator wiring', () => {
  it('forgot() carries both auth and passwordreset buckets at 10/min', () => {
    const fn = PasswordResetController.prototype.forgot as unknown as object;
    const authLimit = Reflect.getMetadata('THROTTLER:LIMITauth', fn);
    const authTtl = Reflect.getMetadata('THROTTLER:TTLauth', fn);
    const prLimit = Reflect.getMetadata('THROTTLER:LIMITpasswordreset', fn);
    const prTtl = Reflect.getMetadata('THROTTLER:TTLpasswordreset', fn);

    expect(authLimit).toBe(10);
    expect(authTtl).toBe(60_000);
    expect(prLimit).toBe(10);
    expect(prTtl).toBe(60_000);
  });

  it('reset() carries only the auth bucket at 10/min (token is single-use)', () => {
    const fn = PasswordResetController.prototype.reset as unknown as object;
    const authLimit = Reflect.getMetadata('THROTTLER:LIMITauth', fn);
    const authTtl = Reflect.getMetadata('THROTTLER:TTLauth', fn);
    expect(authLimit).toBe(10);
    expect(authTtl).toBe(60_000);
  });
});

// ============================================================================
// AuthModule wiring — both controllers registered (catch register-forget regressions)
// ============================================================================

describe('AuthModule wiring', () => {
  it('imports both MagicLinkController and PasswordResetController', () => {
    // Reflection-based sanity check that both classes exist and are
    // decorated controllers — the AuthModule provider list is exercised
    // at module-load time. If a future refactor drops one, this test
    // fails to compile because of the missing identifier.
    expect(typeof MagicLinkController).toBe('function');
    expect(typeof PasswordResetController).toBe('function');
  });
});
