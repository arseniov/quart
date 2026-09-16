import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  cityId: string;
  isSuperAdmin: boolean;
  roleSnapshot: string[];
  // Gh #7: request UUID (or short id when middleware accepts a non-UUID
  // header) mirrored from `req.raw.id` by JwtAuthGuard / RbacGuard so
  // services that build a TenantContext from `user: AuthUser` (no @Req())
  // can thread the real id into the audit row instead of an empty
  // string. Optional — pre-auth paths (magic-link consume, etc.) never
  // see it.
  requestId?: string;
  // T56: session id (== JWT `jti` == `auth_sessions.id` UUID). Populated
  // by JwtAuthGuard so sign-out and any future "revoke my own session"
  // endpoint can target the row without re-reading the JWT. Optional
  // for callers that don't yet attach session id.
  sessionId?: string;
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