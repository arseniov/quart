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
 * The stub HONORS the `WHERE revoked_at IS NULL` guard the production SQL
 * carries — once a jti has been "revoked" by an earlier UPDATE, the next
 * UPDATE for that jti matches zero rows. This is what makes the
 * "idempotent" test below a real regression check for that guard: if
 * the production code lost the filter, the second UPDATE would still
 * match and `updates.length` would be 2 instead of 1.
 *
 * `runInTenantTx` invokes `fn(trx)` synchronously and returns the
 * resolved value — no real transaction is started.
 */
function makeDb() {
  const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const revoked = new Set<string>();
  const trx = {
    updateTable: (table: string) => {
      const chain: {
        patch: Record<string, unknown> | undefined;
        jti: string | undefined;
        revokedAtNull: boolean;
      } = { patch: undefined, jti: undefined, revokedAtNull: false };
      const obj = {
        set: (patch: Record<string, unknown>) => {
          chain.patch = patch;
          return obj;
        },
        where: (col: string, op: string, value: unknown) => {
          if (col === 'id' && op === '=' && typeof value === 'string') {
            chain.jti = value;
          }
          if (col === 'revoked_at' && op === 'is' && value === null) {
            chain.revokedAtNull = true;
          }
          return obj;
        },
        execute: async () => {
          const jti = chain.jti;
          const matches =
            jti !== undefined && chain.revokedAtNull && !revoked.has(jti);
          if (matches) {
            updates.push({ table, patch: chain.patch ?? {} });
            revoked.add(jti);
            return { numUpdatedRows: 1n };
          }
          return { numUpdatedRows: 0n };
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

  return { db, trx, updates, revoked };
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

const FIXED_REQUEST_ID = 'req-123';

// ============================================================================
// Tests
// ============================================================================

describe('SignOutService', () => {
  it('revokes the session by jti and writes an auth.sign_out audit row', async () => {
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey, calls: valkeyCalls } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut(FIXED_USER, FIXED_REQUEST_ID);

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
    expect(ev.tenant.requestId).toBe(FIXED_REQUEST_ID);

    expect(valkeyCalls).toEqual([{ jti: 'jti-1', value: 'revoked', ttl: 60 }]);
  });

  it('falls back to requestId="" when the controller forwards undefined', async () => {
    const { db } = makeDb();
    const { write } = makeAudit();
    const { valkey } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut(FIXED_USER, undefined);

    const ev = (write.mock.calls[0] as unknown as [unknown, AuditCall])[1]!;
    expect(ev.tenant.requestId).toBe('');
  });

  it('idempotent: the second sign-out matches zero UPDATE rows because of WHERE revoked_at IS NULL, but audit still fires', async () => {
    // The stub honors the WHERE guard via a `revoked` Set keyed on jti:
    // the second UPDATE for the same jti matches zero rows, so the
    // service emits one UPDATE + two audit rows. This is a real
    // regression check — if the production code lost the
    // `WHERE revoked_at IS NULL` filter, `updates.length` would be 2
    // and this test would fail.
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut(FIXED_USER, FIXED_REQUEST_ID);
    await svc.signOut(FIXED_USER, FIXED_REQUEST_ID);

    expect(updates).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('succeeds when user.sessionId is missing (no-op guard)', async () => {
    const { db, updates } = makeDb();
    const { write } = makeAudit();
    const { valkey } = makeValkey();

    const svc = new SignOutService(db as never, { write } as never, valkey);
    await svc.signOut({ ...FIXED_USER, sessionId: undefined }, FIXED_REQUEST_ID);

    expect(updates).toHaveLength(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('swallows Valkey errors (cache is best-effort) and logs a warning', async () => {
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
    // logged (pino warn) and swallowed.
    await expect(svc.signOut(FIXED_USER, FIXED_REQUEST_ID)).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('SignOutController', () => {
  it('clears the __Host-quart-api-session cookie and forwards req.id to the service', async () => {
    const service = {
      signOut: vi.fn(async () => undefined),
    } as unknown as SignOutService;
    const res = { clearCookie: vi.fn() } as unknown as { clearCookie: (n: string, o: unknown) => unknown };
    const req = { id: 'req-abc' } as unknown as { id: string };
    const c = new SignOutController(service);

    await c.signOut(FIXED_USER, req as never, res as never);

    expect(service.signOut).toHaveBeenCalledWith(FIXED_USER, 'req-abc');
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
    const service = {
      signOut: vi.fn(async () => undefined),
    } as unknown as SignOutService;
    const res = { clearCookie: vi.fn() } as unknown as { clearCookie: (n: string, o: unknown) => unknown };
    const req = { id: 'req-abc' } as unknown as { id: string };
    const c = new SignOutController(service);

    // The handler returns void so NestJS serializes no body. Asserting
    // the resolved value is undefined locks in the 204 contract — a
    // future change returning `{ ok: true }` would silently flip the
    // status to 200 + body.
    await expect(c.signOut(FIXED_USER, req as never, res as never)).resolves.toBeUndefined();
  });
});
