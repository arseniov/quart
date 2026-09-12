import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import { PERMISSIONS_KEY } from '../../src/rbac/permissions.decorator.js';
import { RbacGuard } from '../../src/rbac/rbac.guard.js';

class StubReflector {
  constructor(private readonly perms: string[]) {}
  getAllAndOverride<T>(key: string, _targets: unknown[]): T | undefined {
    if (key === PERMISSIONS_KEY) return (this.perms.length ? this.perms : undefined) as T;
    return undefined;
  }
}

function ctxWith(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ id: 'r-1', user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

/**
 * Builds a kysely-shaped chain that resolves `rows` on `.execute()`.
 * Chain methods (selectFrom, innerJoin, select, where) are both callable
 * AND chainable: calling them returns the same proxy so further method
 * calls chain naturally. `execute()` resolves the rows.
 */
function kyselyStub(rows: Array<{ code: string }>): unknown {
  const chain: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'execute') return async () => rows;
      return proxy;
    },
    apply() {
      return proxy;
    },
  };
  const proxy = new Proxy(function () {} as unknown as object, chain);
  return proxy;
}

function dbStub(permissionRows: Array<{ code: string }>): DbService {
  const trx = kyselyStub(permissionRows);
  return {
    kysely: kyselyStub([]),
    runInTenantTx: vi.fn(async (_ctx, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
  } as unknown as DbService;
}

const officer: AuthUser = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['municipality_officer'],
};

describe('RbacGuard', () => {
  it('allows when the user has a role that grants the required permission', async () => {
    const g = new RbacGuard(dbStub([{ code: 'admin.issues.read' }]), new StubReflector(['admin.issues.read']));
    await expect(g.canActivate(ctxWith(officer))).resolves.toBe(true);
  });

  it('rejects when the user does not have a role with the required permission', async () => {
    const g = new RbacGuard(dbStub([]), new StubReflector(['admin.audit.verify']));
    let caught: unknown;
    try { await g.canActivate(ctxWith(officer)); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect(((caught as ForbiddenException).getResponse() as { error: { code: string } }).error.code).toBe(
      'rbac.permission_denied',
    );
  });

  it('allows super_admin without checking roles', async () => {
    const g = new RbacGuard(dbStub([]), new StubReflector(['admin.audit.verify']));
    await expect(
      g.canActivate(ctxWith({ ...officer, isSuperAdmin: true })),
    ).resolves.toBe(true);
  });

  it('allows when ANY of the required permissions is held', async () => {
    const g = new RbacGuard(dbStub([{ code: 'admin.issues.assign' }]), new StubReflector(['admin.audit.verify', 'admin.issues.assign']));
    await expect(g.canActivate(ctxWith(officer))).resolves.toBe(true);
  });

  it('allows when no permission is required (decorator not used)', async () => {
    const g = new RbacGuard(dbStub([]), new StubReflector([]));
    await expect(g.canActivate(ctxWith(officer))).resolves.toBe(true);
  });

  it('denies when user has no role_snapshot', async () => {
    const g = new RbacGuard(dbStub([{ code: 'admin.issues.read' }]), new StubReflector(['admin.issues.read']));
    let caught: unknown;
    try { await g.canActivate(ctxWith({ ...officer, roleSnapshot: [] })); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect(((caught as ForbiddenException).getResponse() as { error: { code: string } }).error.code).toBe(
      'rbac.permission_denied',
    );
  });

  it('rejects with auth.missing when req.user is absent', async () => {
    const g = new RbacGuard(dbStub([]), new StubReflector(['admin.issues.read']));
    let caught: unknown;
    try { await g.canActivate(ctxWith(undefined)); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe(
      'auth.missing',
    );
  });
});