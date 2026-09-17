import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { MfaGuard } from '../../src/auth/mfa.guard.js';

function ctxWith(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

const officerBase: AuthUser = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
};

const citizenBase: AuthUser = {
  id: 'u-2',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['citizen'],
};

describe('MfaGuard', () => {
  it('allows a citizen (non-officer) without any MFA claims', async () => {
    const g = new MfaGuard();
    expect(g.canActivate(ctxWith(citizenBase))).toBe(true);
  });

  it('rejects an officer with no mfaSecret/mfaEnrolledAt as mfa.enrollment_required', () => {
    const g = new MfaGuard();
    let caught: unknown;
    try { g.canActivate(ctxWith({ ...officerBase })); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe('mfa.enrollment_required');
  });

  it('rejects an officer with mfaSecret but no mfaEnrolledAt', () => {
    const g = new MfaGuard();
    let caught: unknown;
    try {
      g.canActivate(ctxWith({ ...officerBase, mfaSecret: 'JBSWY3DPEHPK3PXP' }));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe('mfa.enrollment_required');
  });

  it('rejects an enrolled officer with no mfaVerifiedAt as mfa.verification_required', () => {
    const g = new MfaGuard();
    let caught: unknown;
    try {
      g.canActivate(ctxWith({
        ...officerBase,
        mfaSecret: 'JBSWY3DPEHPK3PXP',
        mfaEnrolledAt: Date.now() - 60_000,
      }));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe('mfa.verification_required');
  });

  it('rejects an enrolled officer whose mfaVerifiedAt is older than 5 minutes', () => {
    const g = new MfaGuard();
    let caught: unknown;
    try {
      g.canActivate(ctxWith({
        ...officerBase,
        mfaSecret: 'JBSWY3DPEHPK3PXP',
        mfaEnrolledAt: Date.now() - 10 * 60_000,
        mfaVerifiedAt: Date.now() - 6 * 60_000,
      }));
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe('mfa.verification_required');
  });

  it('allows an enrolled officer verified within the last 5 minutes', () => {
    const g = new MfaGuard();
    const ok = g.canActivate(ctxWith({
      ...officerBase,
      mfaSecret: 'JBSWY3DPEHPK3PXP',
      mfaEnrolledAt: Date.now() - 10 * 60_000,
      mfaVerifiedAt: Date.now() - 60_000,
    }));
    expect(ok).toBe(true);
  });

  it('rejects with auth.missing when req.user is absent', () => {
    const g = new MfaGuard();
    let caught: unknown;
    try { g.canActivate(ctxWith(undefined)); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(((caught as UnauthorizedException).getResponse() as { error: { code: string } }).error.code).toBe('auth.missing');
  });
});