import { Body, Controller, ForbiddenException, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
const ModerateSchema = z.object({
  action: z.enum(['publish', 'hide', 'reject']),
  note: z.string().max(500).optional(),
});

const CommentSchema = z.object({
  body: z.string().min(1).max(5000),
});

// Roles that hold admin.ideas.moderate per 0021_seed_roles_permissions.
const MODERATOR_ROLES = new Set(['moderator', 'quart_admin']);

@Controller('admin/ideas')
@ApiGlobalResponses()
@ApiTags('admin/ideas')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminIdeasController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Post(':id/moderate')
  @RequirePermission('admin.ideas.moderate')
  async moderate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ModerateSchema)) body: z.infer<typeof ModerateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true; status: 'published' | 'hidden' | 'rejected' }> {
    // Defense in depth — the guard already enforces it, but a stale cache or
    // JWT must not escalate. The roleSnapshot comes from claims, which the
    // JwtAuthGuard re-reads from `auth_sessions` on every request.
    const isMod = user.isSuperAdmin || (user.roleSnapshot ?? []).some((r) => MODERATOR_ROLES.has(r));
    if (!isMod) {
      throw new ForbiddenException({
        error: { code: 'rbac.permission_denied', message: 'admin.ideas.moderate' },
      });
    }

    const status: 'published' | 'hidden' | 'rejected' =
      body.action === 'publish' ? 'published' : body.action === 'hide' ? 'hidden' : 'rejected';

    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx
        .updateTable('ideas')
        .set({
          status,
          published_at: status === 'published' ? new Date() : null,
        })
        .where('id', '=', id)
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'idea.moderate',
        targetType: 'idea',
        targetId: id,
        payload: { action: body.action, status, note: body.note ?? null },
      });

      return { ok: true, status };
    });
  }

  @Post(':id/comments')
  @RequirePermission('admin.ideas.moderate')
  async addModeratorComment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CommentSchema)) body: z.infer<typeof CommentSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string; parentType: 'idea'; parentId: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const idea = await trx
        .selectFrom('ideas')
        .select('city_id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();

      const row = await trx
        .insertInto('comments')
        .values({
          city_id: (idea as { city_id: string }).city_id,
          parent_type: 'idea',
          parent_id: id,
          author_user_id: user.id,
          body: body.body,
          status: 'visible',
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'idea.comment',
        targetType: 'idea',
        targetId: id,
        payload: { comment_id: (row as { id: string }).id, moderator: true },
      });

      return { id: (row as { id: string }).id, parentType: 'idea' as const, parentId: id };
    });
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
