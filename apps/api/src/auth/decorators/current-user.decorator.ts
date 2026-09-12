import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  cityId: string;
  isSuperAdmin: boolean;
  roleSnapshot: string[];
  // T17: TOTP secret + enroll timestamp carried in the JWT after enrollment.
  // T18: `mfaVerifiedAt` is stamped by /verify and gates officer endpoints
  // (MfaGuard's 5-min freshness window).
  // `undefined` pre-enrollment, populated post-enrollment once MfaService
  // re-mints the bearer.
  mfaSecret?: string;
  mfaEnrolledAt?: number;
  mfaVerifiedAt?: number;
}

const currentUserFactory = (_data: unknown, ctx: ExecutionContext): AuthUser | null => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  return req.user ?? null;
};

/**
 * Param decorator that injects the `AuthUser` populated by JwtAuthGuard.
 * Returns `null` when the route was skipped (e.g. `@Public()`).
 */
export const CurrentUser = createParamDecorator(currentUserFactory);