import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';
import { Observable, of, lastValueFrom } from 'rxjs';
import { describe, it, expect } from 'vitest';

import { currentTenantFactory } from '../../src/common/decorators/current-tenant.decorator.js';
import { SKIP_TENANT } from '../../src/common/decorators/skip-tenant.decorator.js';
import { TenantContextInterceptor } from '../../src/common/tenant-context.interceptor.js';

const CITY = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const RID = 'r-abc-1234';

type Req = Record<string, unknown>;

function makeCtx(handler: unknown, cls: unknown, req: Req): ExecutionContext {
  const http = { getRequest: () => req };
  return {
    switchToHttp: () => http,
    getHandler: () => handler,
    getClass: () => cls,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeFactoryCtx(req: { tenant?: TenantContext }): ExecutionContext {
  const http = { getRequest: () => req };
  return {
    switchToHttp: () => http,
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

// Stub Reflector: returns the metadata we set up in the test.
class StubReflector {
  constructor(private readonly skipTenant: boolean) {}

  getAllAndOverride<T>(key: string, _targets: unknown[]): T | undefined {
    if (key === SKIP_TENANT) return (this.skipTenant ? true : undefined) as T;
    return undefined;
  }
}

describe('TenantContextInterceptor', () => {
  it('attaches TenantContext to req when all headers present', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: {
        'x-city-id': CITY,
        'x-user-id': USER,
        'x-is-super-admin': 'true',
      },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    const tenant = req.tenant as TenantContext;
    expect(tenant).toEqual({
      cityId: CITY,
      userId: USER,
      isSuperAdmin: true,
      requestId: RID,
    });
  });

  it('treats isSuperAdmin=false when header is "false"', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: {
        'x-city-id': CITY,
        'x-is-super-admin': 'false',
      },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    const tenant = req.tenant as TenantContext;
    expect(tenant.isSuperAdmin).toBe(false);
    expect(tenant.userId).toBeNull();
  });

  it('rejects invalid cityId even when other headers are valid', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: {
        'x-city-id': 'not-a-uuid',
        'x-user-id': USER,
        'x-is-super-admin': 'true',
      },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    expect(req.tenant).toBeUndefined();
  });

  it('passes through when no tenant headers present', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = { id: RID, headers: {} };
    const seen: unknown[] = [];
    const next: CallHandler = {
      handle: () =>
        new Observable((sub) => {
          seen.push(req.tenant);
          sub.next('ok');
          sub.complete();
        }),
    };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    expect(req.tenant).toBeUndefined();
    expect(seen[0]).toBeUndefined();
  });

  it('passes through with only X-Is-Super-Admin: true (no cityId/userId)', async () => {
    // RLS grants catalog write purely on app.is_super_admin, so a
    // context with cityId: '' and isSuperAdmin: true must not be
    // producible from partial headers.
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: { 'x-is-super-admin': 'true' },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    expect(req.tenant).toBeUndefined();
  });

  it('rejects a malformed X-City-Id and does not build a context', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: { 'x-city-id': 'bogus' },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    expect(req.tenant).toBeUndefined();
  });

  it('builds a context with userId=null and isSuperAdmin=false when only X-City-Id is valid', async () => {
    const i = new TenantContextInterceptor(new StubReflector(false) as never);
    const req: Req = {
      id: RID,
      headers: { 'x-city-id': CITY },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    const tenant = req.tenant as TenantContext;
    expect(tenant).toEqual({
      cityId: CITY,
      userId: null,
      isSuperAdmin: false,
      requestId: RID,
    });
  });

  it('skips tenant work when handler is decorated with @SkipTenant', async () => {
    const i = new TenantContextInterceptor(new StubReflector(true) as never);
    const req: Req = {
      id: RID,
      headers: {
        'x-city-id': CITY,
        'x-user-id': USER,
        'x-is-super-admin': 'true',
      },
    };
    const next: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(i.intercept(makeCtx({}, {}, req), next));

    expect(req.tenant).toBeUndefined();
  });
});

describe('currentTenantFactory', () => {
  it('returns the TenantContext attached to the request', () => {
    const attached: TenantContext = {
      cityId: CITY,
      userId: USER,
      isSuperAdmin: false,
      requestId: RID,
    };
    expect(currentTenantFactory(undefined, makeFactoryCtx({ tenant: attached }))).toEqual(attached);
  });

  it('returns null when no TenantContext is attached', () => {
    expect(currentTenantFactory(undefined, makeFactoryCtx({}))).toBeNull();
  });
});
