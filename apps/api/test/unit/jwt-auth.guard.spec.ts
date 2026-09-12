import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, it, expect, vi } from 'vitest';

import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import type { JwtService } from '../../src/auth/jwt.service.js';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator.js';
import type { ValkeyService } from '../../src/auth/valkey.service.js';
import type { DbService } from '../../src/db/db.service.js';

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

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);

function kyselyStub(row: unknown): DbService {
  return {
    kysely: {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              executeTakeFirst: async () => row,
            }),
          }),
        }),
      }),
    },
  } as unknown as DbService;
}

describe('JwtAuthGuard', () => {
  const claims = {
    sub: 'u-1',
    city_id: 'c-1',
    scope_type: 'city' as const,
    scope_id: 'c-1',
    role_snapshot: ['citizen'],
    device_fingerprint: null,
  };
  const validToken = 'valid.jwt.token';
  const req: unknown = {
    id: 'r-1',
    headers: { authorization: `Bearer ${validToken}` },
  };

  function build(
    svc: JwtService,
    db: DbService,
    valkey: ValkeyService,
    isPublic = false,
  ): JwtAuthGuard {
    return new JwtAuthGuard(
      new StubReflector(isPublic) as unknown as Reflector,
      svc,
      db,
      valkey,
    );
  }

  it('skips auth when @Public() is set on the handler/class', async () => {
    const jwt = { verify: vi.fn() } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = {} as ValkeyService;
    const g = build(jwt, db, valkey, true);
    await expect(g.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('throws auth.missing when Authorization header is absent', async () => {
    const g = build({ verify: vi.fn() } as never, {} as never, {} as never);
    const err = await g.canActivate(makeCtx({ headers: {} })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.missing');
  });

  it('throws auth.invalid when JWT verify throws', async () => {
    const jwt = { verify: vi.fn(async () => { throw new Error('bad sig'); }) } as unknown as JwtService;
    const g = build(jwt, {} as DbService, {} as ValkeyService);
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.invalid');
  });

  it('throws auth.session_revoked when DB returns no session', async () => {
    // Covers the realistic case: SQL `where revoked_at is null` has already
    // filtered out any revoked rows, so a null result means the session is
    // either missing or revoked.
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-x' })) } as unknown as JwtService;
    const db = kyselyStub(null);
    const valkey = {
      getSession: vi.fn(async () => null),
      setSession: vi.fn(async () => undefined),
    } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.session_revoked');
  });

  it('throws auth.session_expired when absolute_expires_at is in the past', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-e' })) } as unknown as JwtService;
    const db = kyselyStub({ id: 'sess-e', revoked_at: null, absolute_expires_at: past });
    const valkey = {
      getSession: vi.fn(async () => null),
      setSession: vi.fn(async () => undefined),
    } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.session_expired');
  });

  it('throws auth.session_revoked when Valkey cached "revoked"', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-r' })) } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = { getSession: vi.fn(async () => 'revoked') } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.session_revoked');
  });

  it('throws auth.cache_unavailable when Valkey throws (fail-closed)', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-c' })) } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = { getSession: vi.fn(async () => { throw new Error('valkey down'); }) } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.cache_unavailable');
  });

  it('throws auth.fingerprint_mismatch when device_fingerprint claim differs from header', async () => {
    const claimsWithFp = { ...claims, jti: 'sess-f', device_fingerprint: 'fp-original' };
    const jwt = { verify: vi.fn(async () => claimsWithFp) } as unknown as JwtService;
    const db = kyselyStub({ id: 'sess-f', revoked_at: null, absolute_expires_at: future });
    const valkey = {
      getSession: vi.fn(async () => null),
      setSession: vi.fn(async () => undefined),
    } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const fpReq = { id: 'r-1', headers: { authorization: 'Bearer t', 'x-device-fingerprint': 'fp-other' } };
    const err = await g.canActivate(makeCtx(fpReq)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.fingerprint_mismatch');
  });

  it('attaches req.user and req.tenant on success', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-ok' })) } as unknown as JwtService;
    const db = kyselyStub({ id: 'sess-ok', revoked_at: null, absolute_expires_at: future });
    const valkey = {
      getSession: vi.fn(async () => null),
      setSession: vi.fn(async () => undefined),
    } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    const requestObj: { headers: Record<string, string>; id: string; user?: unknown; tenant?: unknown } = {
      id: 'r-abc',
      headers: { authorization: 'Bearer t' },
    };
    await expect(g.canActivate(makeCtx(requestObj))).resolves.toBe(true);
    expect(requestObj.user).toEqual({
      id: 'u-1',
      cityId: 'c-1',
      isSuperAdmin: false,
      roleSnapshot: ['citizen'],
    });
    expect(requestObj.tenant).toEqual({
      cityId: 'c-1',
      userId: 'u-1',
      isSuperAdmin: false,
      requestId: 'r-abc',
    });
  });

  it('accepts a valid token with valid session (cache "ok" path)', async () => {
    const jwt = { verify: vi.fn(async () => ({ ...claims, jti: 'sess-3' })) } as unknown as JwtService;
    const db = {} as DbService;
    const valkey = { getSession: vi.fn(async () => 'ok') } as unknown as ValkeyService;
    const g = build(jwt, db, valkey);
    await expect(g.canActivate(makeCtx(req))).resolves.toBe(true);
  });

  it('accepts when device fingerprint matches', async () => {
    const claimsWithFp = { ...claims, jti: 'sess-fp', device_fingerprint: 'deadbeef' };
    const jwt = { verify: vi.fn(async () => claimsWithFp) } as unknown as JwtService;
    const db = kyselyStub({ id: 'sess-fp', revoked_at: null, absolute_expires_at: future });
    const valkey = { getSession: vi.fn(async () => null) } as unknown as ValkeyService;
    const fpReq = { headers: { authorization: 'Bearer valid', 'x-device-fingerprint': 'deadbeef' }, id: 'req-1' };
    const g = build(jwt, db, valkey, false);
    await expect(g.canActivate(makeCtx(fpReq))).resolves.toBe(true);
  });
});