// apps/api/src/auth/__tests__/ba-audit.hook.spec.ts
// GH #34: tests for the BA databaseHook (session.create.after) and the
// plugin matcher (hooks.after for /sign-out). Mirrors the
// login.controller.spec.ts pattern — stubbed DbService + AuditService
// + SessionService, asserts the audit chain row shape and the
// discriminator naming convention documented in ba-audit.hook.ts.

import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../audit/audit.service.js';
import type { DbService } from '../../db/db.service.js';
import {
  BA_SIGN_OUT_AUDIT_PLUGIN_ID,
  baDatabaseHooks,
  baSessionCreateHook,
  baSignOutAuditPlugin,
} from '../ba-audit.hook.js';
// Value import — `new SessionService(...)` below needs the runtime ctor.
import { SessionService } from '../session.service.js';

const BA_USER_ID = 'ba-user-1';
const BA_SESSION_ID = 'ba-session-1';
const QUART_USER_ID = '33333333-3333-3333-3333-333333333333';
const CITY_ID = '22222222-2222-2222-2222-222222222222';

interface DbState {
  baUsers: Array<{ id: string; email: string; createdAt: Date }>;
  baAccounts: Array<{ providerId: string; userId: string; createdAt: Date }>;
  quartUsers: Array<{
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

interface SystemAuditCall {
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// Stubs — same shape as login.controller.spec.ts's makeDoubles but
// extended with BA `user` / `account` tables.
// ---------------------------------------------------------------------------

function makeDb(state: DbState): DbService {
  const baUserBuilder = {
    select: (_cols: unknown) => ({
      where: (col: unknown, op: string, value: unknown) => ({
        executeTakeFirst: async () => {
          if (col !== 'id' || op !== '=') return undefined;
          return state.baUsers.find((u) => u.id === value) ?? null;
        },
      }),
    }),
  };
  const baAccountBuilder = {
    select: (_cols: unknown) => ({
      where: (col: unknown, op: string, value: unknown) => ({
        orderBy: (_c: unknown, _d: unknown) => ({
          limit: (n: number) => ({
            executeTakeFirst: async () => {
              if (col !== 'userId' || op !== '=') return null;
              const matches = state.baAccounts
                .filter((a) => a.userId === value)
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
              return matches.slice(0, n)[0] ?? null;
            },
          }),
        }),
      }),
    }),
  };
  const quartUsersBuilder = {
    select: (_cols: unknown) => ({
      where: (col: unknown, op: string, value: unknown) => ({
        executeTakeFirst: async () => {
          if (col !== 'email' || op !== '=') return undefined;
          return state.quartUsers.find((u) => u.email === value) ?? undefined;
        },
      }),
    }),
  };
  const userRolesBuilder = {
    innerJoin: (_t: unknown, _a: unknown, _b: unknown) => ({
      select: (_cols: unknown) => ({
        where: (col: unknown, op: string, value: unknown) => ({
          execute: async () => {
            if (col !== 'user_roles.user_id' || op !== '=') return [];
            const matches = state.userRoles.filter((r) => r.user_id === value);
            const codes = matches
              .map((r) => state.roles.find((rl) => rl.id === r.role_id)?.code)
              .filter((c): c is string => Boolean(c));
            return codes.map((code) => ({ code }));
          },
        }),
      }),
    }),
  };
  const builders = {
    selectFrom: (table: unknown) => {
      if (table === 'user') return baUserBuilder;
      if (table === 'account') return baAccountBuilder;
      if (table === 'users') return quartUsersBuilder;
      if (table === 'user_roles') return userRolesBuilder;
      throw new Error(`unexpected selectFrom: ${String(table)}`);
    },
    insertInto: (_t: unknown) => ({
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
  } as unknown as DbService;
}

function makeAudit() {
  const calls: SystemAuditCall[] = [];
  return {
    calls,
    write: vi.fn(async (_trx: unknown, ev: SystemAuditCall) => {
      calls.push(ev);
    }),
    writeSystem: vi.fn(
      async (_db: unknown, ev: SystemAuditCall, m?: (trx: unknown) => Promise<unknown>) => {
        if (m) await m({});
        calls.push(ev);
      },
    ),
  };
}

function makeDoubles(overrides: {
  baUser?: { id: string; email: string; createdAt?: Date } | null;
  baAccounts?: Array<{ providerId: string; userId: string; createdAt: Date }>;
  quartUser?: DbState['quartUsers'][number] | null;
  userRoles?: Array<{ user_id: string; role_id: string }>;
  roles?: Array<{ id: string; code: string }>;
}) {
  const now = new Date();
  const state: DbState = {
    baUsers: overrides.baUser
      ? [
          {
            id: overrides.baUser.id,
            email: overrides.baUser.email,
            createdAt: overrides.baUser.createdAt ?? new Date(now.getTime() - 60_000),
          },
        ]
      : [],
    baAccounts: overrides.baAccounts ?? [],
    quartUsers: overrides.quartUser ? [overrides.quartUser] : [],
    userRoles: overrides.userRoles ?? [],
    roles: overrides.roles ?? [{ id: 'role-1', code: 'citizen' }],
    authSessions: [],
  };
  const db = makeDb(state);
  const audit = makeAudit();
  const sessions = new SessionService(
    db,
    audit as unknown as AuditService,
  );
  return { state, db, audit, sessions };
}

// ---------------------------------------------------------------------------
// Tests: baSessionCreateHook (databaseHooks.session.create.after)
// ---------------------------------------------------------------------------

describe('baSessionCreateHook', () => {
  it('writes session_created with via: ba_google for a fresh Google sign-in', async () => {
    const { db, sessions, audit, state } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'alice@example.com' },
      baAccounts: [
        { providerId: 'google', userId: BA_USER_ID, createdAt: new Date() },
      ],
      quartUser: {
        id: QUART_USER_ID,
        handle: 'alice',
        display_name: 'Alice',
        email: 'alice@example.com',
        phone_e164: null,
        avatar_url: null,
        locale: 'it',
        default_city_id: CITY_ID,
        status: 'active',
      },
      userRoles: [{ user_id: QUART_USER_ID, role_id: 'role-1' }],
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
      ipAddress: '203.0.113.1',
      userAgent: 'mobile-test',
    });

    expect(audit.calls.map((c) => c.action)).toEqual(['session_created']);
    expect(audit.calls[0]!.payload).toMatchObject({
      via: 'ba_google',
      ba_session_id: BA_SESSION_ID,
    });
    expect(state.authSessions).toHaveLength(1);
    expect(state.authSessions[0]!.user_id).toBe(QUART_USER_ID);
    expect(state.authSessions[0]!.ip).toBe('203.0.113.1');
    expect(state.authSessions[0]!.user_agent).toBe('mobile-test');
  });

  it('writes via: ba_apple for an Apple social sign-in', async () => {
    const { db, sessions, audit } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'bob@example.com' },
      baAccounts: [
        { providerId: 'apple', userId: BA_USER_ID, createdAt: new Date() },
      ],
      quartUser: {
        id: QUART_USER_ID,
        handle: 'bob',
        display_name: 'Bob',
        email: 'bob@example.com',
        phone_e164: null,
        avatar_url: null,
        locale: 'en',
        default_city_id: CITY_ID,
        status: 'active',
      },
      userRoles: [{ user_id: QUART_USER_ID, role_id: 'role-1' }],
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(audit.calls[0]!.payload).toMatchObject({ via: 'ba_apple' });
  });

  it('writes via: ba_email_login for credential sign-in (existing BA user)', async () => {
    const longAgo = new Date(Date.now() - 60_000 * 60 * 24 * 30); // 30d old
    const { db, sessions, audit } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'carol@example.com', createdAt: longAgo },
      baAccounts: [
        { providerId: 'credential', userId: BA_USER_ID, createdAt: longAgo },
      ],
      quartUser: {
        id: QUART_USER_ID,
        handle: 'carol',
        display_name: 'Carol',
        email: 'carol@example.com',
        phone_e164: null,
        avatar_url: null,
        locale: 'en',
        default_city_id: CITY_ID,
        status: 'active',
      },
      userRoles: [{ user_id: QUART_USER_ID, role_id: 'role-1' }],
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(audit.calls[0]!.payload).toMatchObject({ via: 'ba_email_login' });
  });

  it('writes via: ba_email_signup for credential sign-up (BA user just created)', async () => {
    const justNow = new Date(Date.now() - 1_000); // 1s old — within the 30s signup window
    const { db, sessions, audit } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'dave@example.com', createdAt: justNow },
      baAccounts: [
        { providerId: 'credential', userId: BA_USER_ID, createdAt: justNow },
      ],
      quartUser: {
        id: QUART_USER_ID,
        handle: 'dave',
        display_name: 'Dave',
        email: 'dave@example.com',
        phone_e164: null,
        avatar_url: null,
        locale: 'en',
        default_city_id: CITY_ID,
        status: 'active',
      },
      userRoles: [{ user_id: QUART_USER_ID, role_id: 'role-1' }],
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(audit.calls[0]!.payload).toMatchObject({ via: 'ba_email_signup' });
  });

  it('skips the chain row when the Quart user row is missing (orphan BA session)', async () => {
    const { db, sessions, audit, state } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'orphan@example.com' },
      baAccounts: [
        { providerId: 'google', userId: BA_USER_ID, createdAt: new Date() },
      ],
      quartUser: null,
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Audit chain row suppressed — the BA session exists but Quart has
    // no projection, so there's no city to anchor the row under. The
    // hook logs a warn but doesn't throw.
    expect(audit.calls).toHaveLength(0);
    expect(state.authSessions).toHaveLength(0);
  });

  it('skips the chain row when the Quart user is soft-deleted', async () => {
    const { db, sessions, audit } = makeDoubles({
      baUser: { id: BA_USER_ID, email: 'ghost@example.com' },
      baAccounts: [
        { providerId: 'credential', userId: BA_USER_ID, createdAt: new Date() },
      ],
      quartUser: {
        id: QUART_USER_ID,
        handle: 'ghost',
        display_name: 'Ghost',
        email: 'ghost@example.com',
        phone_e164: null,
        avatar_url: null,
        locale: 'en',
        default_city_id: CITY_ID,
        status: 'deleted',
      },
    });

    const hook = baSessionCreateHook({ db, sessions });
    await hook({
      id: BA_SESSION_ID,
      userId: BA_USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(audit.calls).toHaveLength(0);
  });

  it('does not throw when the underlying DB query fails (audit failures are non-fatal)', async () => {
    const audit = makeAudit();
    const db = {
      kysely: {
        selectFrom: () => {
          throw new Error('db down');
        },
      },
    } as unknown as DbService;
    const sessions = {} as SessionService;
    const hook = baSessionCreateHook({ db, sessions });
    // Must not throw — BA's sign-in response must not break on audit
    // failures. The hook logs a warn and swallows.
    await expect(
      hook({
        id: BA_SESSION_ID,
        userId: BA_USER_ID,
        expiresAt: new Date(),
      }),
    ).resolves.toBeUndefined();
    expect(audit.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: baDatabaseHooks (splices into BetterAuthOptions)
// ---------------------------------------------------------------------------

describe('baDatabaseHooks', () => {
  it('produces a hooks object with session.create.after wired', () => {
    const { sessions } = makeDoubles({});
    const hooks = baDatabaseHooks({ db: undefined as never, sessions });
    expect(hooks.session?.create?.after).toBeTypeOf('function');
    expect(hooks.session?.create?.before).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: baSignOutAuditPlugin (plugin-level hooks.after matcher)
// ---------------------------------------------------------------------------

describe('baSignOutAuditPlugin', () => {
  it('exposes the plugin id so the BA router registers it', () => {
    const audit = makeAudit();
    const plugin = baSignOutAuditPlugin({ audit: audit as unknown as AuditService, db: undefined as never });
    expect(plugin.id).toBe(BA_SIGN_OUT_AUDIT_PLUGIN_ID);
    expect(plugin.hooks?.after).toHaveLength(1);
  });

  it('matcher fires only on path === /sign-out', () => {
    const audit = makeAudit();
    const plugin = baSignOutAuditPlugin({ audit: audit as unknown as AuditService, db: undefined as never });
    const matcher = plugin.hooks!.after![0]!.matcher as (ctx: unknown) => boolean;
    expect(matcher({ path: '/sign-out' })).toBe(true);
    expect(matcher({ path: '/sign-in/email' })).toBe(false);
    expect(matcher({ path: '/sign-in/social' })).toBe(false);
    expect(matcher({ path: '/list-sessions' })).toBe(false);
  });

  it('handler writes auth.sign_out with the BA session token as targetId', async () => {
    const audit = makeAudit();
    const db = { kysely: {} } as unknown as DbService;
    const plugin = baSignOutAuditPlugin({ audit: audit as unknown as AuditService, db });
    const handler = plugin.hooks!.after![0]!.handler as (ctx: unknown) => Promise<void>;
    await handler({
      path: '/sign-out',
      context: {
        session: {
          session: { token: 'ba-tok-xyz', userId: BA_USER_ID },
          user: { id: BA_USER_ID, email: 'alice@example.com' },
        },
      },
    });

    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]!.action).toBe('auth.sign_out');
    expect(audit.calls[0]!.targetType).toBe('session');
    expect(audit.calls[0]!.targetId).toBe('ba:ba-tok-xyz');
    expect(audit.calls[0]!.payload).toMatchObject({
      via: 'ba_sign_out',
      ba_user_id: BA_USER_ID,
    });
  });

  it('handler skips when no session token is attached (unauthenticated /sign-out)', async () => {
    const audit = makeAudit();
    const plugin = baSignOutAuditPlugin({ audit: audit as unknown as AuditService, db: undefined as never });
    const handler = plugin.hooks!.after![0]!.handler as (ctx: unknown) => Promise<void>;
    await handler({ path: '/sign-out', context: { session: null } });

    // Nothing to anchor the row under — the matcher fired (BA returns
    // success on /sign-out even when no session is present), but our
    // chain has nothing to attest.
    expect(audit.calls).toHaveLength(0);
  });

  it('handler swallows DB write failures (sign-out response must not break)', async () => {
    const audit = {
      writeSystem: vi.fn(async () => {
        throw new Error('db down');
      }),
    };
    const plugin = baSignOutAuditPlugin({ audit: audit as unknown as AuditService, db: undefined as never });
    const handler = plugin.hooks!.after![0]!.handler as (ctx: unknown) => Promise<void>;
    await expect(
      handler({
        path: '/sign-out',
        context: { session: { session: { token: 'ba-tok', userId: 'u' } } },
      }),
    ).resolves.toBeUndefined();
  });
});