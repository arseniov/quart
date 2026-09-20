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
import type { MfaService } from '../mfa.service.js';
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

// GH #45 follow-up: BaAuthGuard now reads mfa_credentials via
// MfaService.getMfaState to populate req.user.mfaEnrolledAt +
// req.user.mfaVerifiedAt. Tests inject a vi.fn() for it; the default
// returns "not enrolled" so existing tests don't break.
function makeMfa(overrides: Partial<MfaService> = {}): MfaService {
  return {
    getMfaState: vi.fn(async () => ({ enrolledAt: null, verifiedAt: null })),
    ...overrides,
  } as unknown as MfaService;
}

function build(auth: AuthService, isPublic = false, mfa: MfaService = makeMfa()): BaAuthGuard {
  return new BaAuthGuard(
    new StubReflector(isPublic) as unknown as Reflector,
    auth,
    mfa,
  );
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
    // GH #45 follow-up: when MfaService.getMfaState returns null
    // timestamps (the default), mfaEnrolledAt + mfaVerifiedAt stay
    // undefined on req.user — MfaGuard then fails closed.
    expect(requestObj.user).toEqual({
      id: BA_USER_ID,
      cityId: '',
      isSuperAdmin: false,
      roleSnapshot: [],
      requestId: 'r-abc',
      sessionId: BA_SESSION_ID,
    });
    expect(requestObj.tenant).toEqual({
      cityId: '',
      userId: BA_USER_ID,
      isSuperAdmin: false,
      requestId: 'r-abc',
    });
  });

  it('populates user.mfaEnrolledAt + user.mfaVerifiedAt from mfa_credentials (GH #45 follow-up)', async () => {
    // The guard's lookup is the post-GH #45 source of MFA claims —
    // BaAuthGuard runs first, reads the row, hands timestamps to
    // MfaGuard via req.user.
    const enrolledAt = new Date('2026-01-01T00:00:00Z');
    const verifiedAt = new Date('2026-01-01T00:05:00Z');
    const getSession = vi.fn(async () => sessionResponse);
    const getMfaState = vi.fn(async () => ({ enrolledAt, verifiedAt }));
    const mfa = { getMfaState } as unknown as MfaService;
    const g = build(makeAuth(getSession), false, mfa);
    const requestObj: { headers: Record<string, string>; id: string; user?: { mfaEnrolledAt?: number; mfaVerifiedAt?: number } } = {
      id: 'r-1',
      headers: { authorization: 'Bearer t' },
    };
    await g.canActivate(makeCtx(requestObj));
    expect(getMfaState).toHaveBeenCalledWith(BA_USER_ID, '');
    expect(requestObj.user?.mfaEnrolledAt).toBe(enrolledAt.getTime());
    expect(requestObj.user?.mfaVerifiedAt).toBe(verifiedAt.getTime());
  });

  it('populates mfaEnrolledAt only when verifiedAt is null (fresh enrollment)', async () => {
    // Fresh-enrollment state: enrolledAt is set, verifiedAt is null.
    // MfaGuard's `!user.mfaVerifiedAt` branch handles the rest.
    const enrolledAt = new Date('2026-01-01T00:00:00Z');
    const getSession = vi.fn(async () => sessionResponse);
    const mfa = { getMfaState: vi.fn(async () => ({ enrolledAt, verifiedAt: null })) } as unknown as MfaService;
    const g = build(makeAuth(getSession), false, mfa);
    const requestObj: { headers: Record<string, string>; id: string; user?: { mfaEnrolledAt?: number; mfaVerifiedAt?: number } } = {
      id: 'r-1',
      headers: { authorization: 'Bearer t' },
    };
    await g.canActivate(makeCtx(requestObj));
    expect(requestObj.user?.mfaEnrolledAt).toBe(enrolledAt.getTime());
    expect(requestObj.user?.mfaVerifiedAt).toBeUndefined();
  });

  it('defaults to not enrolled (both claims undefined) when getMfaState throws', async () => {
    // Fail-closed: a DB hiccup MUST NOT let an officer endpoint through.
    // The error is logged (best-effort) and the request continues with
    // no MFA claims — MfaGuard rejects with enrollment_required.
    const getSession = vi.fn(async () => sessionResponse);
    const mfa = { getMfaState: vi.fn(async () => { throw new Error('db down'); }) } as unknown as MfaService;
    const g = build(makeAuth(getSession), false, mfa);
    const requestObj: { headers: Record<string, string>; id: string; user?: { mfaEnrolledAt?: number; mfaVerifiedAt?: number } } = {
      id: 'r-1',
      headers: { authorization: 'Bearer t' },
    };
    await expect(g.canActivate(makeCtx(requestObj))).resolves.toBe(true);
    expect(requestObj.user?.mfaEnrolledAt).toBeUndefined();
    expect(requestObj.user?.mfaVerifiedAt).toBeUndefined();
  });

  it('defaults to not enrolled when getMfaState returns null timestamps', async () => {
    // The default `makeMfa()` returns null timestamps — assert that the
    // happy path's req.user has neither claim set.
    const getSession = vi.fn(async () => sessionResponse);
    const g = build(makeAuth(getSession));
    const requestObj: { headers: Record<string, string>; id: string; user?: { mfaEnrolledAt?: number; mfaVerifiedAt?: number } } = {
      id: 'r-1',
      headers: { authorization: 'Bearer t' },
    };
    await g.canActivate(makeCtx(requestObj));
    expect(requestObj.user?.mfaEnrolledAt).toBeUndefined();
    expect(requestObj.user?.mfaVerifiedAt).toBeUndefined();
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