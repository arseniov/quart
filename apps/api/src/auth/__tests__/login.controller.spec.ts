// apps/api/src/auth/__tests__/login.controller.spec.ts
// GH #33: POST /auth/login. Tests cover the five paths the spec asks for:
// happy (200 + session tokens + user), 422 (invalid body), 401 (BA rejects
// credentials OR Quart user is gone), audit chain assertions
// (session_created on success, auth.email_login_failed on failure), and
// the Nest DI graph compiles.
//
// Mirrors the phone-otp controller spec structure (apps/api/src/auth/
// __tests__/phone-otp.controller.spec.ts) so a reviewer can diff the two
// side-by-side.

import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../../audit/audit.service.js';
import { DbService } from '../../db/db.service.js';
import { AuthService } from '../auth.service.js';
import { JwtService } from '../jwt.service.js';
import { LoginController } from '../login.controller.js';
import { LoginService, extractLoginContext } from '../login.service.js';
import { SessionService } from '../session.service.js';

const EMAIL = 'alice@example.com';
const PASSWORD = 'correct-horse-battery-staple';
const REQUEST_ID_UUID = '11111111-1111-1111-1111-111111111111';
const CITY_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const ACCESS_TOKEN = 'access.jwt.stub';
const REFRESH_TOKEN = 'refresh.jwt.stub';

interface DbState {
  users: Array<{
    id: string;
    handle: string;
    display_name: string;
    email: string | null;
    phone_e164: string | null;
    avatar_url: string | null;
    locale: string;
    default_city_id: string | null;
    status: 'active' | 'suspended' | 'deleted';
  }>;
  userRoles: Array<{ user_id: string; role_id: string }>;
  roles: Array<{ id: string; code: string }>;
  authSessions: Array<{
    id: string;
    user_id: string;
    device_fingerprint: string | null;
    ip: string | null;
    user_agent: string;
    absolute_expires_at: Date;
  }>;
}

interface AuditCall {
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Stubs — kept inline rather than extracted to fixtures because each suite
// needs slightly different defaults (BA-rejects vs Quart-user-missing vs
// happy).
// ---------------------------------------------------------------------------

function makeDb(state: DbState) {
  // Kysely-shaped builder stub. The service uses:
  //   - selectFrom('users')...where(email).executeTakeFirst
  //   - selectFrom('user_roles').innerJoin('roles').select('roles.code')
  //   - insertInto('auth_sessions').values().execute
  //   - transaction().execute(fn) for the runInTenantTx wrap
  const usersBuilder = {
    select: (_cols: unknown) => ({
      where: (_field: string, _op: string, value: unknown) => ({
        executeTakeFirst: async () => {
          const found = state.users.find((u) => u.email === value);
          return found ?? undefined;
        },
      }),
    }),
  };
  const userRolesBuilder = {
    innerJoin: (_table: string, _col1: string, _col2: string) => ({
      select: (_cols: unknown) => ({
        where: (_field: string, _op: string, value: unknown) => ({
          execute: async () => {
            const matches = state.userRoles.filter((ur) => ur.user_id === value);
            return matches
              .map((ur) => {
                const role = state.roles.find((r) => r.id === ur.role_id);
                return role ? { code: role.code } : null;
              })
              .filter((r): r is { code: string } => r !== null);
          },
        }),
      }),
    }),
  };
  const builders = {
    selectFrom: (table: unknown) => {
      if (table === 'users') return usersBuilder;
      if (table === 'user_roles') return userRolesBuilder;
      throw new Error(`unexpected selectFrom: ${String(table)}`);
    },
    insertInto: (_table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        execute: async () => {
          state.authSessions.push({
            id: String(v['id']),
            user_id: String(v['user_id']),
            device_fingerprint: (v['device_fingerprint'] as string | null) ?? null,
            ip: (v['ip'] as string | null) ?? null,
            user_agent: String(v['user_agent'] ?? ''),
            absolute_expires_at: v['absolute_expires_at'] as Date,
          });
        },
      }),
    }),
    transaction: () => ({
      execute: async (fn: (trx: unknown) => Promise<unknown>) => fn({}),
    }),
  };
  return {
    kysely: builders,
    runInTenantTx: async (_ctx: unknown, fn: (trx: unknown) => Promise<unknown>) =>
      fn(builders),
  };
}

function makeAudit() {
  const calls: AuditCall[] = [];
  return {
    calls,
    write: vi.fn(async (_trx: unknown, ev: AuditCall) => {
      calls.push(ev);
    }),
    writeSystem: vi.fn(
      async (_db: unknown, ev: AuditCall, mutate?: (trx: unknown) => Promise<unknown>) => {
        if (mutate) await mutate({});
        calls.push(ev);
      },
    ),
  };
}

function makeAuth(verifyResult: 'ok' | 'reject') {
  const signInEmail = vi.fn(async () => {
    if (verifyResult === 'ok') {
      return { user: { id: USER_ID, email: EMAIL }, redirect: false, url: undefined };
    }
    // Mirrors BA's `INVALID_EMAIL_OR_PASSWORD` shape so the catch branch
    // exercises the same path as a real failure.
    const err = new Error('Invalid email or password') as Error & { body?: { code?: string } };
    err.body = { code: 'INVALID_EMAIL_OR_PASSWORD' };
    throw err;
  });
  return {
    instance: { api: { signInEmail } },
    signInEmail,
  } as unknown as AuthService;
}

function makeJwt() {
  return {
    sign: vi.fn(async (_claims: unknown, opts: { jti: string; ttlSeconds: number }) => {
      if (opts.ttlSeconds === 60 * 60) return ACCESS_TOKEN;
      return REFRESH_TOKEN;
    }),
  } as unknown as JwtService;
}

function makeDoubles(overrides: {
  verify?: 'ok' | 'reject';
  user?: DbState['users'][number] | null;
  roles?: Array<{ id: string; code: string }>;
  userRoles?: Array<{ user_id: string; role_id: string }>;
}) {
  const state: DbState = {
    users: overrides.user ? [overrides.user] : [],
    userRoles: overrides.userRoles ?? [],
    roles: overrides.roles ?? [{ id: 'role-1', code: 'citizen' }],
    authSessions: [],
  };
  const db = makeDb(state);
  const audit = makeAudit();
  const jwt = makeJwt();
  const auth = makeAuth(overrides.verify ?? 'ok');
  const sessions = new SessionService(
    db as unknown as DbService,
    jwt,
    audit as unknown as AuditService,
  );
  const service = new LoginService(
    auth,
    db as unknown as DbService,
    sessions,
    audit as unknown as AuditService,
  );
  return { state, db, audit, auth, jwt, sessions, service };
}

function activeUser(overrides: Partial<DbState['users'][number]> = {}): DbState['users'][number] {
  return {
    id: USER_ID,
    handle: 'alice',
    display_name: 'Alice',
    email: EMAIL,
    phone_e164: null,
    avatar_url: null,
    locale: 'it',
    default_city_id: CITY_ID,
    status: 'active',
    ...overrides,
  };
}

const baseContext = {
  email: EMAIL,
  password: PASSWORD,
  requestId: REQUEST_ID_UUID,
  ip: '203.0.113.1',
  userAgent: 'jest',
  deviceFingerprint: 'fp-123',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginService.signInAndIssueSession', () => {
  it('happy path: signs in via BA, mints session, returns full session shape', async () => {
    const { service, state, audit, auth } = makeDoubles({
      user: activeUser(),
      userRoles: [{ user_id: USER_ID, role_id: 'role-1' }],
    });

    const out = await service.signInAndIssueSession(baseContext);

    // BA was called with normalized email + raw password.
    const signInEmail = (auth as unknown as { signInEmail: ReturnType<typeof vi.fn> }).signInEmail;
    expect(signInEmail).toHaveBeenCalledWith({
      body: { email: EMAIL, password: PASSWORD },
    });

    // Session row inserted with the expected shape.
    expect(state.authSessions).toHaveLength(1);
    const row = state.authSessions[0]!;
    expect(row.user_id).toBe(USER_ID);
    expect(row.device_fingerprint).toBe('fp-123');
    expect(row.ip).toBe('203.0.113.1');
    expect(row.user_agent).toBe('jest');
    expect(row.absolute_expires_at.getTime()).toBeGreaterThan(Date.now());

    // Audit chain has exactly one row: session_created with via: email_login.
    expect(audit.calls.map((c) => c.action)).toEqual(['session_created']);
    expect(audit.calls[0]!.payload).toMatchObject({
      via: 'email_login',
      device_fingerprint: 'fp-123',
    });

    // Response shape matches the email-login contract.
    expect(out.access_token).toBe(ACCESS_TOKEN);
    expect(out.refresh_token).toBe(REFRESH_TOKEN);
    expect(typeof out.refresh_expires_at).toBe('string');
    expect(new Date(out.refresh_expires_at).getTime()).toBe(row.absolute_expires_at.getTime());
    expect(out.user).toEqual({
      id: USER_ID,
      handle: 'alice',
      display_name: 'Alice',
      email: EMAIL,
      phone_e164: null,
      avatar_url: null,
      preferred_locale: 'it',
      city_id: CITY_ID,
      needs_onboarding: false,
      roles: ['citizen'],
    });
  });

  it('happy path: signs the access JWT with the session id as jti', async () => {
    const { service, state, jwt } = makeDoubles({
      user: activeUser(),
      userRoles: [{ user_id: USER_ID, role_id: 'role-1' }],
    });
    const signMock = jwt.sign as unknown as ReturnType<typeof vi.fn>;

    await service.signInAndIssueSession(baseContext);

    expect(signMock).toHaveBeenCalledTimes(2);
    const optsAccess = signMock.mock.calls[0]![1] as { jti: string; ttlSeconds: number };
    const optsRefresh = signMock.mock.calls[1]![1] as { jti: string; ttlSeconds: number };
    expect(optsAccess.ttlSeconds).toBe(60 * 60);
    expect(optsRefresh.ttlSeconds).toBe(60 * 60 * 24 * 30);
    expect(optsAccess.jti).toBe(optsRefresh.jti);
    expect(optsAccess.jti).toBe(state.authSessions[0]!.id);
  });

  it('401 wrong password: throws UnauthorizedException, no session, audit logs failed attempt', async () => {
    const { service, state, audit } = makeDoubles({
      verify: 'reject',
      user: activeUser(),
    });

    await expect(service.signInAndIssueSession(baseContext)).rejects.toMatchObject({
      response: { error: { code: 'auth.login_invalid_credentials' } },
      status: 401,
    });

    // No session row, no session_created audit — but auth.email_login_failed
    // DOES land under the sentinel city so brute-force is visible.
    expect(state.authSessions).toHaveLength(0);
    expect(audit.calls.map((c) => c.action)).toEqual(['auth.email_login_failed']);
    expect(audit.calls[0]!.payload).toMatchObject({ email: EMAIL });
  });

  it('401 unknown email (BA rejects): treated the same as wrong password', async () => {
    // BA rejects because no account exists; we never reach the users lookup.
    const { service, state, audit } = makeDoubles({ verify: 'reject' });

    await expect(service.signInAndIssueSession(baseContext)).rejects.toMatchObject({
      response: { error: { code: 'auth.login_invalid_credentials' } },
      status: 401,
    });
    expect(state.authSessions).toHaveLength(0);
    expect(audit.calls.map((c) => c.action)).toEqual(['auth.email_login_failed']);
  });

  it('401 soft-deleted Quart user (BA accepted but users.status=deleted): also fails', async () => {
    const { service, state, audit } = makeDoubles({
      user: activeUser({ status: 'deleted' }),
    });

    await expect(service.signInAndIssueSession(baseContext)).rejects.toMatchObject({
      status: 401,
    });
    expect(state.authSessions).toHaveLength(0);
    expect(audit.calls.map((c) => c.action)).toEqual(['auth.email_login_failed']);
  });

  it('401 BA accepts but no Quart user row (orphan account): treated as failure', async () => {
    // BA returns a user but the Quart `users` lookup misses — must NOT
    // mint a session, must write the failure audit.
    const { service, state, audit } = makeDoubles({ user: null });

    await expect(service.signInAndIssueSession(baseContext)).rejects.toMatchObject({
      status: 401,
    });
    expect(state.authSessions).toHaveLength(0);
    expect(audit.calls.map((c) => c.action)).toEqual(['auth.email_login_failed']);
  });

  it('falls back to writeSystem for session_created when the user has no default_city_id', async () => {
    const { service, audit } = makeDoubles({
      user: activeUser({ default_city_id: null }),
      userRoles: [{ user_id: USER_ID, role_id: 'role-1' }],
    });

    await service.signInAndIssueSession(baseContext);

    // session_created still lands, but via writeSystem (no tenant ctx).
    expect(audit.calls.map((c) => c.action)).toEqual(['session_created']);
  });

  it('a null request_id does not crash the audit chain', async () => {
    const { service, audit } = makeDoubles({
      user: activeUser(),
      userRoles: [{ user_id: USER_ID, role_id: 'role-1' }],
    });
    await service.signInAndIssueSession({ ...baseContext, requestId: null });
    expect(audit.calls).toHaveLength(1);
  });

  it('empty roles: roles array is empty (no join matches)', async () => {
    const { service } = makeDoubles({
      user: activeUser(),
      userRoles: [],
    });

    const out = await service.signInAndIssueSession(baseContext);
    expect(out.user.roles).toEqual([]);
  });

  it('normalizes email to lowercase before calling BA and looking up the user', async () => {
    const { service, auth } = makeDoubles({
      user: activeUser({ email: EMAIL }),
      userRoles: [{ user_id: USER_ID, role_id: 'role-1' }],
    });
    const signInEmail = (auth as unknown as { signInEmail: ReturnType<typeof vi.fn> }).signInEmail;

    await service.signInAndIssueSession({
      ...baseContext,
      email: '  ALICE@Example.COM  ',
    });
    expect(signInEmail).toHaveBeenCalledWith({
      body: { email: EMAIL, password: PASSWORD },
    });
  });
});

describe('extractLoginContext', () => {
  it('maps FastifyRequest to the service boundary', () => {
    const ctx = extractLoginContext({
      id: 'req-fallback',
      raw: { id: REQUEST_ID_UUID },
      ip: '198.51.100.1',
      headers: {
        'user-agent': 'jest-ua',
        'x-device-fingerprint': 'fp-456',
      },
    });
    expect(ctx.requestId).toBe(REQUEST_ID_UUID);
    expect(ctx.ip).toBe('198.51.100.1');
    expect(ctx.userAgent).toBe('jest-ua');
    expect(ctx.deviceFingerprint).toBe('fp-456');
  });

  it('falls back to req.id when raw.id is missing', () => {
    const ctx = extractLoginContext({ id: 'req-only', headers: {} });
    expect(ctx.requestId).toBe('req-only');
  });

  it('returns nulls for missing ip / ua / fingerprint', () => {
    const ctx = extractLoginContext({ id: 'r', headers: {} });
    expect(ctx.ip).toBeNull();
    expect(ctx.userAgent).toBeNull();
    expect(ctx.deviceFingerprint).toBeNull();
  });

  it('accepts string[] headers and takes the first', () => {
    const ctx = extractLoginContext({
      headers: {
        'user-agent': ['ua-1', 'ua-2'],
        'x-device-fingerprint': ['fp-1'],
      },
    });
    expect(ctx.userAgent).toBe('ua-1');
    expect(ctx.deviceFingerprint).toBe('fp-1');
  });
});

describe('LoginController', () => {
  function makeController(verifyResult: 'ok' | 'reject', user: DbState['users'][number] | null) {
    const doubles = makeDoubles({ verify: verifyResult, user });
    const controller = new LoginController(doubles.service);
    const req = {
      id: REQUEST_ID_UUID,
      raw: { id: REQUEST_ID_UUID },
      ip: '203.0.113.1',
      headers: { 'user-agent': 'jest-ua', 'x-device-fingerprint': 'fp-123' },
    };
    return { controller, doubles, req };
  }

  it('POST /login delegates body + req metadata to the service', async () => {
    const { controller, doubles, req } = makeController('ok', activeUser());

    const out = await controller.login(
      { email: EMAIL, password: PASSWORD, deviceFingerprint: 'fp-123' } as never,
      req as never,
    );

    expect(out.access_token).toBe(ACCESS_TOKEN);
    expect(out.refresh_token).toBe(REFRESH_TOKEN);
    expect(doubles.state.authSessions).toHaveLength(1);
  });

  it('POST /login propagates UnauthorizedException when credentials fail', async () => {
    const { controller, doubles, req } = makeController('reject', activeUser());

    await expect(
      controller.login({ email: EMAIL, password: PASSWORD } as never, req as never),
    ).rejects.toMatchObject({
      response: { error: { code: 'auth.login_invalid_credentials' } },
    });
    expect(doubles.state.authSessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nest Test module — confirms the providers wire up correctly (DI graph +
// decorator metadata). Cheap; covers a class of bugs where the test stubs
// pass but the real NestJS bootstrap would fail.
// ---------------------------------------------------------------------------

describe('LoginController (Nest DI graph)', () => {
  it('compiles the full module graph without missing providers', async () => {
    const doubles = makeDoubles({ user: activeUser() });
    const moduleRef = await Test.createTestingModule({
      controllers: [LoginController],
      providers: [
        { provide: DbService, useValue: doubles.db },
        { provide: JwtService, useValue: doubles.jwt },
        { provide: AuditService, useValue: doubles.audit },
        { provide: AuthService, useValue: doubles.auth },
        SessionService,
        LoginService,
      ],
    }).compile();
    expect(moduleRef.get(LoginController)).toBeInstanceOf(LoginController);
    expect(moduleRef.get(LoginService)).toBeInstanceOf(LoginService);
    expect(moduleRef.get(SessionService)).toBeInstanceOf(SessionService);
  });
});
