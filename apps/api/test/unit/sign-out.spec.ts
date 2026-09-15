import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { SignOutController } from '../../src/auth/sign-out.controller.js';
import { SignOutService } from '../../src/auth/sign-out.service.js';
import type { ValkeyService } from '../../src/auth/valkey.service.js';

// ============================================================================
// Test doubles
// ============================================================================

interface AuditCall {
  action: string;
  targetType: string;
  targetId: string;
  payload: unknown;
  tenant: { cityId: string; userId: string; isSuperAdmin: boolean; requestId: string };
}

/**
 * Minimal DbService stub. The service calls
 * `db.runInTenantTx(ctx, fn)` and inside the tx issues an UPDATE against
 * `auth_sessions` and calls `audit.write(trx, ev)`. The stub captures both
 * operations so the tests can assert on them.
 *
 * `runInTenantTx` invokes `fn(trx)` synchronously and returns the
 * resolved value — no real transaction is started. The `trx` object is
 * the same minimal chain used by the password-reset / topics stubs.
 */
function makeDb() {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const trx = {
    updateTable: (table: string) => {
      const chain: { patch: Record<string, unknown> | undefined } = { patch: undefined };
      const obj = {
        set: (patch: Record<string, unknown>) => {
          chain.patch = patch;
          return obj;
        },
        where: () => obj,
        execute: async () => {
          updates.push({ table, patch: chain.patch ?? {} });
          return { numUpdatedRows: 1n };
        },
      };
      return obj;
    },
  };

  const db = {
    runInTenantTx: async (_ctx: unknown, fn: (trx: unknown) => Promise<unknown>) => {
      return fn(trx);
    },
  };

  return { db, trx, updates };
}

function makeAudit() {
  const calls: AuditCall[] = [];
  return {
    calls,
    write: vi.fn(async (_trx: unknown, ev: AuditCall) => {
      calls.push({
        action: ev.action,
        targetType: ev.targetType,
        targetId: ev.targetId,
        payload: ev.payload,
        tenant: ev.tenant,
      });
    }),
  };
}

function makeValkey() {
  const calls: Array<{ jti: string; value: string; ttl: number }> = [];
  const v: Pick<ValkeyService, 'setSession' | 'getSession' | 'client' | 'close' | 'onModuleDestroy'> = {
    client: {} as never,
    getSession: vi.fn(async () => null),
    setSession: vi.fn(async (jti: string, value: string, ttlSeconds: number) => {
      calls.push({ jti, value, ttl: ttlSeconds });
    }),
    close: vi.fn(async () => undefined),
    onModuleDestroy: vi.fn(async () => undefined),
  };
  return { valkey: v as unknown as ValkeyService, calls };
}

const FIXED_USER: AuthUser = {
  id: 'user-1',
  cityId: '11111111-1111-1111-1111-111111111111',
  isSuperAdmin: false,
  roleSnapshot: ['citizen'],
  sessionId: 'jti-1',
};

// ============================================================================
// Tests
// ============================================================================

describe('SignOutService', () => {
  it('revokes the session by jti and writes an auth.sign_out audit row', async () => {
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey, calls: valkeyCalls } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut(FIXED_USER);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe('auth_sessions');
    expect(updates[0]!.patch['revoke_reason']).toBe('signout');
    expect(updates[0]!.patch['revoked_at']).toBeInstanceOf(Date);

    expect(write).toHaveBeenCalledTimes(1);
    const ev = (write.mock.calls[0] as unknown as [unknown, AuditCall])[1]!;
    expect(ev.action).toBe('auth.sign_out');
    expect(ev.targetType).toBe('session');
    expect(ev.targetId).toBe('jti-1');
    expect(ev.payload).toEqual({ jti: 'jti-1' });
    expect(ev.tenant.userId).toBe('user-1');
    expect(ev.tenant.cityId).toBe('11111111-1111-1111-1111-111111111111');

    expect(valkeyCalls).toEqual([{ jti: 'jti-1', value: 'revoked', ttl: 60 }]);
  });

  it('idempotent: a second call for an already-revoked session still completes', async () => {
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut(FIXED_USER);
    await svc.signOut(FIXED_USER);

    // The stubbed UPDATE matches unconditionally; the real UPDATE in
    // production carries `revoked_at IS NULL` so the second call is a
    // 0-row no-op. We assert the service emits two UPDATE + two audit
    // calls — the chain records both events independently. The real
    // idempotency guard (`WHERE revoked_at IS NULL`) is in the SQL.
    expect(updates).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('succeeds when user.sessionId is missing (no-op guard)', async () => {
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut({ ...FIXED_USER, sessionId: undefined });

    expect(updates).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('swallows Valkey errors (cache is best-effort)', async () => {
    const { db } = makeDb();
    const { write } = makeAudit();
    const valkey = {
      client: {} as never,
      getSession: vi.fn(async () => null),
      setSession: vi.fn(async () => { throw new Error('valkey down'); }),
      close: vi.fn(async () => undefined),
      onModuleDestroy: vi.fn(async () => undefined),
    } as unknown as ValkeyService;

    const svc = new SignOutService(db as never, { write } as never, valkey);
    // DB revoke + audit still complete; the valkey poison failure is
    // logged and swallowed.
    await expect(svc.signOut(FIXED_USER)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('SignOutController', () => {
  it('clears the __Host-quart-api-session cookie and returns 204 (passthrough)', async () => {
    const service = { signOut: vi.fn(async () => undefined) } as unknown as SignOutService;
    const res = { clearCookie: vi.fn() } as unknown as { clearCookie: (n: string, o: unknown) => unknown };
    const c = new SignOutController(service);

    await c.signOut(FIXED_USER, res as never);

    expect(service.signOut).toHaveBeenCalledWith(FIXED_USER);
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

  it('does not return a body (void handler for 204 No Content)', async () => {
    const service = { signOut: vi.fn(async () => undefined) } as unknown as SignOutService;
    const res = { clearCookie: vi.fn() } as unknown as { clearCookie: (n: string, o: unknown) => unknown };
    const c = new SignOutController(service);

    // The handler returns void so NestJS serializes no body. Asserting
    // the resolved value is undefined locks in the 204 contract — a
    // future change returning `{ ok: true }` would silently flip the
    // status to 200 + body.
    await expect(c.signOut(FIXED_USER, res as never)).resolves.toBeUndefined();
  });
});