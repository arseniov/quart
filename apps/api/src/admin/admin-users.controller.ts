import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
const UserPatchSchema = z.object({
  roleIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  locale: z.string().optional(),
});

const ListQuerySchema = z.object({
  query: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller('admin/users')
@ApiGlobalResponses()
@ApiTags('admin/users')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminUsersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.users.read')
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) q: z.infer<typeof ListQuerySchema>) {
    let query = this.db.kysely
      .selectFrom('users')
      .select(['id', 'handle', 'display_name', 'email', 'phone_e164', 'status', 'locale', 'default_city_id'])
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    if (q.status) query = query.where('status', '=', q.status);
    return query.execute();
  }

  @Get(':id')
  @RequirePermission('admin.users.read')
  async get(@Param('id') id: string) {
    return this.db.kysely.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  @Patch(':id')
  @RequirePermission('admin.users.role.write')
  async patchUser(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UserPatchSchema)) body: z.infer<typeof UserPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      if (body.roleIds) {
        // Replace existing role grants with the new set; preserves the
        // existing user_roles.city_id by reading first, then re-inserting.
        const existing = await trx
          .selectFrom('user_roles')
          .select('city_id')
          .where('user_id', '=', id)
          .executeTakeFirst();
        await trx.deleteFrom('user_roles').where('user_id', '=', id).execute();
        const cityId = (existing as { city_id: string } | undefined)?.city_id ?? ctx.cityId;
        for (const roleId of body.roleIds) {
          await trx
            .insertInto('user_roles')
            .values({ user_id: id, role_id: roleId, city_id: cityId } as never)
            .execute();
        }
      }
      if (body.status) {
        await trx.updateTable('users').set({ status: body.status }).where('id', '=', id).execute();
      }
      if (body.locale) {
        await trx.updateTable('users').set({ locale: body.locale }).where('id', '=', id).execute();
      }

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'user.patch',
        targetType: 'user',
        targetId: id,
        payload: { changes: Object.keys(body) },
      });

      return { ok: true };
    });
  }

  @Post(':id/suspend')
  @RequirePermission('admin.users.role.write')
  async suspend(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.updateTable('users').set({ status: 'suspended' }).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'user.suspend',
        targetType: 'user',
        targetId: id,
        payload: {},
      });
      return { ok: true };
    });
  }

  @Post(':id/reinstate')
  @RequirePermission('admin.users.role.write')
  async reinstate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.updateTable('users').set({ status: 'active' }).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'user.reinstate',
        targetType: 'user',
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
