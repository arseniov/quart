import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the Reflector constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import { PERMISSIONS_KEY, type PermissionRequirement } from './permissions.decorator.js';

interface RequestWithAuth {
  // Under @nestjs/platform-fastify the wrapped request's top-level `id`
  // is Fastify's default (`'req-N'`); RequestIdMiddleware writes the real
  // request id onto `raw.id`. Read both so the audit chain's `request_id`
  // is populated.
  id?: string;
  raw?: { id?: string };
  user?: AuthUser;
}

type FastifyLikeRequest = FastifyRequest & RequestWithAuth;

/**
 * Permission guard. Runs after JwtAuthGuard (which sets `req.user`).
 *
 * Lookup order:
 *   1. No `@RequirePermission` decorator on handler/class → allow.
 *   2. `user.isSuperAdmin` → bypass (matches MfaGuard super-admin behavior
 *      and the seed migration which only assigns `super.admin` to
 *      `super_admin`; the bypass is the human-readable analogue).
 *   3. Query `role_permissions` JOIN `permissions` JOIN `roles` to find
 *      codes granted to any of the user's role_snapshot entries. ANY-match
 *      semantics: holding at least one required code passes.
 *   4. Empty `role_snapshot` → denied (cannot map codes → role rows).
 *
 * Runs the query inside `runInTenantTx` so RLS GUCs are bound; the
 * `role_permissions` table has no RLS today but `permissions`/`roles`
 * are global tables that read fine in either context. Future RLS on the
 * grant tables keeps the lookup correct without re-plumbing.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly db: DbService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requirements = this.reflector.getAllAndOverride<(string | PermissionRequirement)[]>(
      PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    ) ?? [];

    if (requirements.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<FastifyLikeRequest>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'auth.missing', message: 'no user on request' },
      });
    }
    if (user.isSuperAdmin) return true;

    const codes = requirements.map((r) => (typeof r === 'string' ? r : r.code));
    const roleCodes = user.roleSnapshot ?? [];
    if (roleCodes.length === 0) {
      throw new ForbiddenException({
        error: { code: 'rbac.permission_denied', message: `missing one of: ${codes.join(', ')}` },
      });
    }

    const granted = await this.db.runInTenantTx(
      {
        cityId: user.cityId,
        userId: user.id,
        isSuperAdmin: user.isSuperAdmin,
        requestId: req.raw?.id ?? req.id ?? '',
      },
      async (trx) => {
        // role_permissions.role_id is a UUID; user.roleSnapshot carries
        // role *codes* (e.g. 'municipality_officer'). Join via roles.code.
        const rows = await trx
          .selectFrom('role_permissions')
          .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
          .innerJoin('roles', 'roles.id', 'role_permissions.role_id')
          .select('permissions.code')
          .where('roles.code', 'in', roleCodes)
          .where('permissions.code', 'in', codes)
          .execute();
        return new Set(rows.map((r) => r.code));
      },
    );

    if (granted.size === 0) {
      throw new ForbiddenException({
        error: { code: 'rbac.permission_denied', message: `missing one of: ${codes.join(', ')}` },
      });
    }
    return true;
  }
}