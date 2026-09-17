import { Body, Controller, ForbiddenException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

const CityCreateSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  countryCode: z.string().length(2),
  name: z.string().min(1).max(120),
  localeDefault: z.string().min(2).max(10),
  timezone: z.string().min(1).max(64),
});

const CityPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  localeDefault: z.string().min(2).max(10).optional(),
  timezone: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const AreaCreateSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
});

const NeighborhoodCreateSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  areaId: z.string().uuid().optional(),
});

// City create/update/deactivate are super-admin only. quart_admin can patch
// areas + neighborhoods within their own city (enforced at RLS layer by
// `runInTenantTx`); the controller delegates via the city-scoped tx.
@Controller('admin/cities')
@ApiGlobalResponses()
@ApiTags('admin/cities')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminCitiesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermission('admin.city.write')
  async create(
    @Body(new ZodValidationPipe(CityCreateSchema)) body: z.infer<typeof CityCreateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string }> {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException({
        error: { code: 'city.super_admin_only', message: 'creating cities requires super-admin' },
      });
    }
    // Ponytail: city creation is global, not tenant-scoped — pass an empty
    // cityId GUC so the bypass policies for global tables still apply.
    const globalCtx: TenantContext = {
      cityId: ctx.cityId || user.cityId,
      userId: user.id,
      isSuperAdmin: true,
      requestId: ctx.requestId,
    };
    return this.db.runInTenantTx(globalCtx, async (trx) => {
      const row = await trx
        .insertInto('cities')
        .values({
          slug: body.slug,
          country_code: body.countryCode,
          name: body.name,
          locale_default: body.localeDefault,
          timezone: body.timezone,
          status: 'active',
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.write(trx, {
        tenant: globalCtx,
        action: 'city.create',
        targetType: 'city',
        targetId: (row as { id: string }).id,
        payload: { slug: body.slug, name: body.name },
      });
      return { id: (row as { id: string }).id };
    });
  }

  @Patch(':id')
  @RequirePermission('admin.city.write')
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CityPatchSchema)) body: z.infer<typeof CityPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch['name'] = body.name;
      if (body.localeDefault !== undefined) patch['locale_default'] = body.localeDefault;
      if (body.timezone !== undefined) patch['timezone'] = body.timezone;
      if (body.status !== undefined) patch['status'] = body.status;
      await trx.updateTable('cities').set(patch).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'city.update',
        targetType: 'city',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });
      return { ok: true };
    });
  }

  @Post(':id/deactivate')
  @RequirePermission('admin.city.write')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException({
        error: { code: 'city.super_admin_only', message: 'deactivating cities requires super-admin' },
      });
    }
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.updateTable('cities').set({ status: 'inactive' }).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'city.deactivate',
        targetType: 'city',
        targetId: id,
        payload: {},
      });
      return { ok: true };
    });
  }

  @Post(':id/areas')
  @RequirePermission('admin.city.write')
  async addArea(
    @Param('id') cityId: string,
    @Body(new ZodValidationPipe(AreaCreateSchema)) body: z.infer<typeof AreaCreateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const row = await trx
        .insertInto('city_areas')
        .values({ city_id: cityId, slug: body.slug, name: body.name } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'city.area.create',
        targetType: 'city_area',
        targetId: (row as { id: string }).id,
        payload: { cityId, slug: body.slug },
      });
      return { id: (row as { id: string }).id };
    });
  }

  @Post(':id/areas/:areaId/neighborhoods')
  @RequirePermission('admin.city.write')
  async addNeighborhood(
    @Param('id') _cityId: string,
    @Param('areaId') areaId: string,
    @Body(new ZodValidationPipe(NeighborhoodCreateSchema)) body: z.infer<typeof NeighborhoodCreateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const area = await trx
        .selectFrom('city_areas')
        .select('city_id')
        .where('id', '=', areaId)
        .executeTakeFirstOrThrow();
      const row = await trx
        .insertInto('neighborhoods')
        .values({
          city_id: (area as { city_id: string }).city_id,
          area_id: body.areaId ?? areaId,
          slug: body.slug,
          name: body.name,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'city.neighborhood.create',
        targetType: 'neighborhood',
        targetId: (row as { id: string }).id,
        payload: { areaId, slug: body.slug },
      });
      return { id: (row as { id: string }).id };
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
