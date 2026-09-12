import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

const AuditQuerySchema = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller('admin/audit')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminAuditController {
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('admin.audit.read')
  async list(
    @Query(new ZodValidationPipe(AuditQuerySchema)) q: z.infer<typeof AuditQuerySchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ) {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      let s = trx
        .selectFrom('audit_log')
        .selectAll()
        .orderBy('id', 'desc')
        .limit(q.limit)
        .offset((q.page - 1) * q.limit);
      if (q.actor) s = s.where('actor_user_id', '=', q.actor);
      if (q.action) s = s.where('action', '=', q.action);
      if (q.targetType) s = s.where('target_type', '=', q.targetType);
      if (q.targetId) s = s.where('target_id', '=', q.targetId);
      if (q.from) s = s.where('created_at', '>=', q.from);
      if (q.to) s = s.where('created_at', '<=', q.to);
      return s.execute();
    });
  }

  @Get('anchors')
  @RequirePermission('admin.audit.read')
  async anchors() {
    return this.db.kysely.selectFrom('audit_anchors').selectAll().orderBy('anchored_at', 'desc').execute();
  }

  private tenantCtx(user: AuthUser, ctx: TenantContext): TenantContext {
    return {
      cityId: ctx.cityId || user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: ctx.requestId,
    };
  }
}
