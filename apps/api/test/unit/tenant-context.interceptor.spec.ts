import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';
import { Observable, of, lastValueFrom } from 'rxjs';
import { describe, it, expect } from 'vitest';

import { CurrentTenant } from '../../src/common/decorators/current-tenant.decorator.js';
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

  it('ignores invalid UUIDs and treats them as missing', async () => {
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

describe('@CurrentTenant decorator surface', () => {
  it('is a function (consumed by NestJS reflect-metadata at decoration time)', () => {
    // The decorator is applied via `@CurrentTenant()` and processed by NestJS;
    // its handler invocation is exercised end-to-end by the apply-decorators
    // path, not by calling the returned function directly.
    expect(typeof CurrentTenant).toBe('function');
  });
});
