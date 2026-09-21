import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../../src/auth/auth.service.js';
import { BaAuthGuard } from '../../src/auth/ba-auth.guard.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { MfaService } from '../../src/auth/mfa.service.js';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { MeDevicesController } from '../../src/me/me.controller.js';
import type { MeService } from '../../src/me/me.service.js';

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};
const user = { id: 'u-1' } as unknown as AuthUser;
const req = { user, tenant } as never;

function makeService(overrides: Partial<MeService> = {}): MeService {
  return {
    list: vi.fn(async () => [{ id: 'd-1', deviceId: 'mobile-uuid' } as never]),
    register: vi.fn(async (body) => ({ id: 'd-1', deviceId: body.device_id ?? 'derived' } as never)),
    revoke: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MeService;
}

describe('MeDevicesController', () => {
  let svc: MeService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list delegates to service.list', async () => {
    const c = new MeDevicesController(svc);
    const out = await c.list(req);
    expect(svc.list).toHaveBeenCalledWith(user, tenant);
    expect(out.devices[0].id).toBe('d-1');
  });

  it('register delegates to service.register and returns ok + id + deviceId', async () => {
    const c = new MeDevicesController(svc);
    const body = {
      device_id: 'mobile-uuid',
      platform: 'ios',
      expo_push_token: 'ExponentPushToken[abc]',
      app_version: '1.0.0',
      locale: 'en',
    } as const;
    const r = await c.register(body, req);
    expect(svc.register).toHaveBeenCalledWith(body, user, tenant);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('d-1');
    expect(r.deviceId).toBe('mobile-uuid');
  });

  it('revoke delegates to service.revoke and returns void', async () => {
    const c = new MeDevicesController(svc);
    await c.revoke('mobile-uuid', req);
    expect(svc.revoke).toHaveBeenCalledWith('mobile-uuid', user, tenant);
  });
});

// ============================================================================
// Auth gate — the controller class declares @UseGuards(BaAuthGuard, RbacGuard).
// We exercise BaAuthGuard directly here (same one the controller wires) to
// prove the gate fires for unauthenticated requests. rbac.guard.spec.ts
// already covers the RbacGuard half.
// ============================================================================
class StubReflector {
  constructor(private readonly publicFlag: boolean) {}
  getAllAndOverride<T>(key: string, _targets: unknown[]): T | undefined {
    if (key === IS_PUBLIC_KEY) return (this.publicFlag ? true : undefined) as T;
    return undefined;
  }
}

function makeCtx(req: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ status: () => undefined }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function build(): BaAuthGuard {
  return new BaAuthGuard(
    new StubReflector(false) as unknown as Reflector,
    { instance: { api: { getSession: vi.fn() } } } as unknown as AuthService,
    {} as unknown as DbService,
    { getMfaState: vi.fn(async () => ({ enrolledAt: null, verifiedAt: null })) } as unknown as MfaService,
  );
}

describe('MeDevicesController auth gate (no cookie → 401)', () => {
  it('throws auth.missing when the request has no Authorization header', async () => {
    const g = build();
    let caught: unknown;
    try { await g.canActivate(makeCtx({ headers: {} })); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    const resp = (caught as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.missing');
  });
});