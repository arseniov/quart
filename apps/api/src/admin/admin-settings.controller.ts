import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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

const SettingsPatchSchema = z.object({
  civicPointRules: z.unknown().optional(),
  notificationTemplates: z.unknown().optional(),
  featureFlags: z.unknown().optional(),
});

@Controller('admin/settings')
@ApiGlobalResponses()
@ApiTags('admin/settings')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, MfaGuard, RbacGuard)
export class AdminSettingsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.city.write')
  async list() {
    return this.db.kysely.selectFrom('app_settings').selectAll().execute();
  }

  @Patch()
  @RequirePermission('admin.city.write')
  async patch(
    @Body(new ZodValidationPipe(SettingsPatchSchema)) body: z.infer<typeof SettingsPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        await trx
          .insertInto('app_settings')
          .values({ key, value, updated_at: new Date() } as never)
          .onConflict((oc) =>
            oc.column('key').doUpdateSet({ value: value as never, updated_at: new Date() }),
          )
          .execute();
      }

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'settings.update',
        targetType: 'app_settings',
        targetId: '*',
        payload: { keys: Object.keys(body) },
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
