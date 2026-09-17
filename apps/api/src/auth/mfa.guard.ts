import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from './decorators/current-user.decorator.js';
import { MFA_ENFORCED_ROLES } from './roles.js';

const MFA_VERIFICATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * Composite guard for officer/admin endpoints. Runs AFTER JwtAuthGuard so
 * `req.user` is populated. Three failure codes:
 *   - auth.missing             — guard wired without JwtAuthGuard upstream
 *   - mfa.enrollment_required  — officer role but no TOTP secret/enroll time
 *   - mfa.verification_required — officer enrolled but no verify within 5min
 *
 * Plan §T18 uses two separate guards (Enrolled + Verified). The task
 * consolidates them into one to keep the controller decorator list short
 * and ensure enrollment is always checked before the freshness check.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = (req as unknown as { user?: AuthUser }).user;
    if (!user) {
      throw new UnauthorizedException({ error: { code: 'auth.missing', message: 'no user on request' } });
    }

    const requiresMfa = MFA_ENFORCED_ROLES.some((role) => user.roleSnapshot?.includes(role));
    if (!requiresMfa) return true;

    if (!user.mfaSecret || !user.mfaEnrolledAt) {
      throw new UnauthorizedException({
        error: { code: 'mfa.enrollment_required', message: 'admin/officer role requires MFA enrollment' },
      });
    }

    if (!user.mfaVerifiedAt || Date.now() - user.mfaVerifiedAt > MFA_VERIFICATION_WINDOW_MS) {
      throw new UnauthorizedException({
        error: { code: 'mfa.verification_required', message: 'admin/officer role requires MFA verification within the last 5 minutes' },
      });
    }

    return true;
  }
}