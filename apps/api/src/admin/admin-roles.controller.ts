import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import { BaAuthGuard } from '../auth/ba-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

const RoleCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isOfficer: z.boolean().default(false),
});

const RolePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  isOfficer: z.boolean().optional(),
});

@Controller('admin/roles')
@ApiGlobalResponses()
@ApiTags('admin/roles')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, MfaGuard, RbacGuard)
export class AdminRolesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.users.read')
  async list() {
    return this.db.kysely.selectFrom('roles').selectAll().execute();
  }

  @Post()
  @RequirePermission('admin.users.role.write')
  async create(
    @Body(new ZodValidationPipe(RoleCreateSchema)) body: z.infer<typeof RoleCreateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const row = await trx
        .insertInto('roles')
        .values({
          code: body.code,
          name: body.name,
          description: body.description ?? null,
          is_officer: body.isOfficer,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'role.create',
        targetType: 'role',
        targetId: (row as { id: string }).id,
        payload: { code: body.code, isOfficer: body.isOfficer },
      });

      return { id: (row as { id: string }).id };
    });
  }

  @Patch(':id')
  @RequirePermission('admin.users.role.write')
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RolePatchSchema)) body: z.infer<typeof RolePatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch['name'] = body.name;
      if (body.description !== undefined) patch['description'] = body.description;
      if (body.isOfficer !== undefined) patch['is_officer'] = body.isOfficer;
      await trx.updateTable('roles').set(patch).where('id', '=', id).execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'role.update',
        targetType: 'role',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });
      return { ok: true };
    });
  }

  @Delete(':id')
  @RequirePermission('admin.users.role.write')
  async del(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.deleteFrom('roles').where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'role.delete',
        targetType: 'role',
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
