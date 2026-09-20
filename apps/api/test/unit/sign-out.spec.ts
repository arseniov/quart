import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { SignOutController } from '../../src/auth/sign-out.controller.js';
import { SignOutService } from '../../src/auth/sign-out.service.js';

// ============================================================================
// Test doubles
// ============================================================================

interface SystemAuditCall {
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * GH #45: sign-out delegates the session revoke to Better Auth
 * (`auth.instance.api.signOut({ headers })`) and writes a sentinel-city
 * `auth.sign_out` audit row. The `auth_sessions` row is no longer
 * touched — BA owns the runtime session and the Quart row stays as a
 * write-only audit artifact (chain correlation only).
 *
 * The stub below captures the BA call + the audit row, which is the
 * full extent of what the service does.
 */
function makeAuth(overrides: { baSignOut?: () => Promise<unknown> } = {}) {
  const calls: Array<{ headers: Headers }> = [];
  const baSignOut = overrides.baSignOut ?? (async () => undefined);
  const api = {
    signOut: vi.fn(async ({ headers }: { headers: Headers }) => {
      calls.push({ headers });
      return baSignOut();
    }),
  };
  const auth = {
    instance: { api },
  } as unknown as ConstructorParameters<typeof SignOutService>[0];
  return { auth, api, calls };
}

function makeAudit() {
  const calls: SystemAuditCall[] = [];
  return {
    calls,
    writeSystem: vi.fn(async (_db: unknown, ev: SystemAuditCall) => {
      calls.push(ev);
    }),
  };
}

function makeDb() {
  return { kysely: {} } as unknown as ConstructorParameters<typeof SignOutService>[2];
}

const FIXED_USER: AuthUser = {
  id: 'user-1',
  cityId: '11111111-1111-1111-1111-111111111111',
  isSuperAdmin: false,
  roleSnapshot: ['citizen'],
  sessionId: 'ba-session-1',
};

const FIXED_REQUEST_ID = 'req-123';

// ============================================================================
// Tests
// ============================================================================

describe('SignOutService', () => {
  it('forwards the Authorization header into BA /sign-out and writes auth.sign_out audit row', async () => {
    const { auth, calls: baCalls } = makeAuth();
    const audit = makeAudit();
    const db = makeDb();

    const svc = new SignOutService(auth, audit as never, db);
    await svc.signOut(FIXED_USER, FIXED_REQUEST_ID, 'Bearer ba-token-xyz');

    // BA was hit with the bearer.
    expect(baCalls).toHaveLength(1);
    expect(baCalls[0]!.headers.get('authorization')).toBe('Bearer ba-token-xyz');

    // Quart audit row landed with via: 'quart_sign_out' (distinct from BA's
    // 'ba_sign_out' so chain walks can tell the two paths apart).
    expect(audit.writeSystem).toHaveBeenCalledTimes(1);
    const ev = audit.calls[0]!;
    expect(ev.action).toBe('auth.sign_out');
    expect(ev.targetType).toBe('session');
    expect(ev.targetId).toBe('ba:ba-session-1');
    expect(ev.payload).toEqual({
      via: 'quart_sign_out',
      user_id: 'user-1',
      ba_session_id: 'ba-session-1',
    });
    expect(ev.requestId).toBe(FIXED_REQUEST_ID);
  });

  it('falls back to user.id in the targetId when user.sessionId is missing', async () => {
    const { auth, calls: baCalls } = makeAuth();
    const audit = makeAudit();
    const db = makeDb();

    const svc = new SignOutService(auth, audit as never, db);
    await svc.signOut({ ...FIXED_USER, sessionId: undefined }, FIXED_REQUEST_ID, 'Bearer ba-token-xyz');

    expect(baCalls).toHaveLength(1);
    expect(audit.calls[0]!.targetId).toBe('user:user-1');
    expect(audit.calls[0]!.payload['ba_session_id']).toBeNull();
  });

  it('skips the BA call when no Authorization header is present (still writes the audit row)', async () => {
    const { auth, calls: baCalls } = makeAuth();
    const audit = makeAudit();
    const db = makeDb();

    const svc = new SignOutService(auth, audit as never, db);
    await svc.signOut(FIXED_USER, FIXED_REQUEST_ID, undefined);

    expect(baCalls).toHaveLength(0);
    expect(audit.writeSystem).toHaveBeenCalledTimes(1);
  });

  it('swallows BA sign-out failures (non-fatal — concurrent revoke / expired cookie)', async () => {
    const { auth } = makeAuth({
      baSignOut: async () => { throw new Error('ba 401'); },
    });
    const audit = makeAudit();
    const db = makeDb();

    const svc = new SignOutService(auth, audit as never, db);
    // The Quart audit row still lands — the §3.8 chain is the source of
    // truth for sign-out events regardless of BA's response shape.
    await expect(
      svc.signOut(FIXED_USER, FIXED_REQUEST_ID, 'Bearer ba-token-xyz'),
    ).resolves.toBeUndefined();
    expect(audit.writeSystem).toHaveBeenCalledTimes(1);
  });

  it('swallows audit write failures (sign-out response must not break)', async () => {
    const { auth } = makeAuth();
    const audit = {
      writeSystem: vi.fn(async () => { throw new Error('db down'); }),
    };
    const db = makeDb();

    const svc = new SignOutService(auth, audit as never, db);
    await expect(
      svc.signOut(FIXED_USER, FIXED_REQUEST_ID, 'Bearer ba-token-xyz'),
    ).resolves.toBeUndefined();
  });
});

describe('SignOutController', () => {
  function makeRes() {
    return {
      clearCookie: vi.fn(),
    } as unknown as { clearCookie: (n: string, o: unknown) => unknown };
  }

  it('clears the __Host-quart-api-session cookie and forwards req.id + Authorization to the service', async () => {
    const service = {
      signOut: vi.fn(async () => undefined),
    } as unknown as SignOutService;
    const res = makeRes();
    const req = {
      id: 'req-abc',
      headers: { authorization: 'Bearer ba-token-xyz' },
    } as unknown as { id: string; headers: Record<string, string> };
    const c = new SignOutController(service);

    await c.signOut(FIXED_USER, req as never, res as never);

    expect(service.signOut).toHaveBeenCalledWith(FIXED_USER, 'req-abc', 'Bearer ba-token-xyz');
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    const [name, opts] = (res.clearCookie.mock.calls[0] as unknown as [string, Record<string, unknown>])!;
    expect(name).toBe('__Host-quart-api-session');
    expect(opts).toMatchObject({
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'lax',
      maxAge: 0,
    });
  });

  it('accepts the capitalized Authorization header (Fastify normalises lowercase)', async () => {
    const service = {
      signOut: vi.fn(async () => undefined),
    } as unknown as SignOutService;
    const res = makeRes();
    const req = {
      id: 'req-abc',
      headers: { Authorization: 'Bearer ba-token-xyz' },
    } as unknown as { id: string; headers: Record<string, string> };
    const c = new SignOutController(service);

    await c.signOut(FIXED_USER, req as never, res as never);

    expect(service.signOut).toHaveBeenCalledWith(FIXED_USER, 'req-abc', 'Bearer ba-token-xyz');
  });

  it('does not return a body (void handler for 204 No Content)', async () => {
    const service = {
      signOut: vi.fn(async () => undefined),
    } as unknown as SignOutService;
    const res = makeRes();
    const req = {
      id: 'req-abc',
      headers: {},
    } as unknown as { id: string; headers: Record<string, string> };
    const c = new SignOutController(service);

    // The handler returns void so NestJS serializes no body. Asserting
    // the resolved value is undefined locks in the 204 contract — a
    // future change returning `{ ok: true }` would silently flip the
    // status to 200 + body.
    await expect(c.signOut(FIXED_USER, req as never, res as never)).resolves.toBeUndefined();
  });
});
