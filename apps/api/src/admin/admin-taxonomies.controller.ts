import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
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
const TopicCategoryPatchSchema = z.object({
  nameI18n: z.record(z.string(), z.string()).optional(),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

const IssueCategoryPatchSchema = z.object({
  nameI18n: z.record(z.string(), z.string()).optional(),
  defaultSlaHours: z.number().int().min(0).optional(),
  iconName: z.string().max(64).optional(),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

@Controller('admin/taxonomies')
@ApiGlobalResponses()
@ApiTags('admin/taxonomies')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminTaxonomiesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.taxonomy.write')
  async list(user: AuthUser, ctx: TenantContext) {
    // Read-side runs through the city-scoped tx so RLS bypass policies for
    // global taxonomy definitions apply. No audit row for read.
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const [topics, issueCategories] = await Promise.all([
        trx.selectFrom('topic_categories').selectAll().execute(),
        trx.selectFrom('issue_categories').selectAll().execute(),
      ]);
      return { topicCategories: topics, issueCategories };
    });
  }

  @Patch('topic-categories/:id')
  @RequirePermission('admin.taxonomy.write')
  async patchTopicCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(TopicCategoryPatchSchema)) body: z.infer<typeof TopicCategoryPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.nameI18n !== undefined) patch['name_i18n'] = body.nameI18n;
      if (body.sortOrder !== undefined) patch['sort_order'] = body.sortOrder;
      if (body.status !== undefined) patch['status'] = body.status;
      await trx.updateTable('topic_categories').set(patch).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'taxonomy.topic_category.update',
        targetType: 'topic_category',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });
      return { ok: true };
    });
  }

  @Patch('issue-categories/:id')
  @RequirePermission('admin.taxonomy.write')
  async patchIssueCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IssueCategoryPatchSchema)) body: z.infer<typeof IssueCategoryPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.nameI18n !== undefined) patch['name_i18n'] = body.nameI18n;
      if (body.defaultSlaHours !== undefined) patch['default_sla_hours'] = body.defaultSlaHours;
      if (body.iconName !== undefined) patch['icon_name'] = body.iconName;
      if (body.colorHex !== undefined) patch['color_hex'] = body.colorHex;
      if (body.status !== undefined) patch['status'] = body.status;
      await trx.updateTable('issue_categories').set(patch).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'taxonomy.issue_category.update',
        targetType: 'issue_category',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });
      return { ok: true };
    });
  }

  @Delete('topic-categories/:id')
  @RequirePermission('admin.taxonomy.write')
  async archiveTopicCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.updateTable('topic_categories').set({ status: 'archived' }).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'taxonomy.topic_category.archive',
        targetType: 'topic_category',
        targetId: id,
        payload: {},
      });
      return { ok: true };
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
