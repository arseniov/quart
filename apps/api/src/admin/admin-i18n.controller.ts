import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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

const PatchKeySchema = z.object({
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  value: z.string().min(0).max(10_000),
});

const ListQuerySchema = z.object({
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  prefix: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Translations live as app_settings rows with `i18n:mobile:{locale}:{key}`.
// This avoids adding an i18n-specific table and lets the same KV shape
// back feature flags + civic-point rules (see 0009 migration). The 0028
// migration adds `admin.i18n.write` so writes are gated.
@Controller('admin/i18n')
@ApiTags('admin/i18n')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminI18nController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.i18n.write')
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) _q: z.infer<typeof ListQuerySchema>) {
    // Read filters by the i18n:mobile:* prefix; consumers can filter on
    // `locale` and `prefix` client-side. Keeps the controller side-effect free.
    return this.db.kysely
      .selectFrom('app_settings')
      .selectAll()
      .where('key', 'like', 'i18n:%')
      .execute();
  }

  @Patch(':key')
  @RequirePermission('admin.i18n.write')
  async patchKey(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(PatchKeySchema)) body: z.infer<typeof PatchKeySchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    const fullKey = `i18n:mobile:${body.locale}:${key}`;
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx
        .insertInto('app_settings')
        .values({ key: fullKey, value: body.value, updated_at: new Date() } as never)
        .onConflict((oc) =>
          oc.column('key').doUpdateSet({ value: body.value as never, updated_at: new Date() }),
        )
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'i18n.key.update',
        targetType: 'i18n_key',
        targetId: fullKey,
        payload: { locale: body.locale, key, length: body.value.length },
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
