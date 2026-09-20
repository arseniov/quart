// apps/api/src/auth/__tests__/ba-auth.guard.spec.ts
// GH #44: smoke tests for BaAuthGuard. Mirrors jwt-auth.guard.spec.ts
// structure (StubReflector + makeCtx) so a reviewer can diff the two.
// We only assert the public surface the GH #44 task lists:
//   - @Public() short-circuit
//   - missing/invalid Authorization header -> 401
//   - BA getSession throws -> 401
//   - BA getSession returns null -> 401
//   - happy path: BA returns session -> req.user + req.tenant populated
//
// BA is mocked as a plain object (the BA `instance.api.getSession` shape
// is what the guard actually reads; matching the ba-audit.hook.spec.ts
// stub pattern).

import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../auth.service.js';
import { BaAuthGuard } from '../ba-auth.guard.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';

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

function makeAuth(getSession: (...args: unknown[]) => Promise<unknown>): AuthService {
  return {
    instance: { api: { getSession } },
  } as unknown as AuthService;
}

function build(auth: AuthService, isPublic = false): BaAuthGuard {
  return new BaAuthGuard(new StubReflector(isPublic) as unknown as Reflector, auth);
}

const BA_USER_ID = 'ba-user-1';
const BA_SESSION_ID = 'ba-session-1';
const sessionResponse = {
  session: { id: BA_SESSION_ID, userId: BA_USER_ID, token: 'tok', expiresAt: new Date() },
  user: { id: BA_USER_ID, email: 'alice@example.com', name: 'Alice' },
};

describe('BaAuthGuard', () => {
  it('skips auth when @Public() is set on the handler/class', async () => {
    const getSession = vi.fn();
    const g = build(makeAuth(getSession), true);
    await expect(g.canActivate(makeCtx({ headers: {} }))).resolves.toBe(true);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('throws auth.missing when Authorization header is absent', async () => {
    const g = build(makeAuth(vi.fn()));
    const err = await g.canActivate(makeCtx({ headers: {} })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.missing');
  });

  it('throws auth.session_invalid when getSession rejects', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('ba unreachable');
    });
    const g = build(makeAuth(getSession));
    const req = { id: 'r-1', headers: { authorization: 'Bearer t' } };
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.session_invalid');
  });

  it('throws auth.session_invalid when getSession returns null', async () => {
    const getSession = vi.fn(async () => null);
    const g = build(makeAuth(getSession));
    const req = { id: 'r-1', headers: { authorization: 'Bearer t' } };
    const err = await g.canActivate(makeCtx(req)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    const resp = (err as UnauthorizedException).getResponse() as { error: { code: string } };
    expect(resp.error.code).toBe('auth.session_invalid');
  });

  it('forwards the Authorization header to BA getSession', async () => {
    const getSession: ReturnType<typeof vi.fn> = vi.fn(async () => sessionResponse);
    const g = build(makeAuth(getSession as never));
    await g.canActivate(makeCtx({ id: 'r-1', headers: { authorization: 'Bearer abc' } }));
    expect(getSession).toHaveBeenCalledTimes(1);
    const arg = (getSession.mock.calls[0] as unknown[])[0] as { headers: Headers };
    expect(arg.headers).toBeInstanceOf(Headers);
    expect(arg.headers.get('authorization')).toBe('Bearer abc');
  });

  it('attaches req.user and req.tenant on success', async () => {
    const getSession = vi.fn(async () => sessionResponse);
    const g = build(makeAuth(getSession));
    const requestObj: { headers: Record<string, string>; id: string; user?: unknown; tenant?: unknown } = {
      id: 'r-abc',
      headers: { authorization: 'Bearer t' },
    };
    await expect(g.canActivate(makeCtx(requestObj))).resolves.toBe(true);
    expect(requestObj.user).toEqual({
      id: BA_USER_ID,
      cityId: '',
      isSuperAdmin: false,
      roleSnapshot: [],
      requestId: 'r-abc',
    });
    expect(requestObj.tenant).toEqual({
      cityId: '',
      userId: BA_USER_ID,
      isSuperAdmin: false,
      requestId: 'r-abc',
    });
  });

  it('reads the request id from raw.id when req.id is the fastify default', async () => {
    const getSession = vi.fn(async () => sessionResponse);
    const g = build(makeAuth(getSession));
    const requestObj: { headers: Record<string, string>; raw: { id: string }; user?: unknown } = {
      headers: { authorization: 'Bearer t' },
      raw: { id: 'r-raw' },
    };
    await expect(g.canActivate(makeCtx(requestObj))).resolves.toBe(true);
    expect((requestObj.user as { requestId: string }).requestId).toBe('r-raw');
  });
});