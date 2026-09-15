import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

// Dashboard reads are scoped per city via RLS (`app.city_id` is set inside
// runInTenantTx). Super-admins still pass a `cityId` query param — they pick
// which tenant to look at; the bypass doesn't grant a "see everything"
// fan-out through this endpoint.
const Q = z.object({ cityId: z.string().uuid() });

interface IssueCountRow {
  last7d: number | string | bigint;
  last30d: number | string | bigint;
  all: number | string | bigint;
}

@Controller('admin/dashboard')
@ApiGlobalResponses()
@ApiTags('admin/dashboard')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminDashboardController {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  constructor(private readonly db: DbService) {}

  @Get()
  @RequirePermission('admin.dashboard.read')
  async dashboard(
    @Query(new ZodValidationPipe(Q)) q: z.infer<typeof Q>,
    @CurrentUser() _user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ cityId: string; last7d: number; last30d: number; all: number }> {
    // Use the caller-supplied cityId as the tenant — RLS limits the read to
    // that city's rows even if the JWT-bound cityId differs.
    const tenantCtx: TenantContext = { ...ctx, cityId: q.cityId };
    return this.db.runInTenantTx(tenantCtx, async (trx) => {
      // Three aggregates in one pass via PostgreSQL `FILTER (WHERE ...)`.
      // ponytail: also matches the plan — see T57.
      // FIX: extend to count ideas / polls / comments / recent audit events.
      const r = (await trx
        .selectFrom('issues')
        .select((eb) => [
          eb.fn
            .countAll<string>()
            .filterWhere('created_at', '>=', new Date(Date.now() - 7 * 86_400_000))
            .as('last7d'),
          eb.fn
            .countAll<string>()
            .filterWhere('created_at', '>=', new Date(Date.now() - 30 * 86_400_000))
            .as('last30d'),
          eb.fn.countAll<string>().as('all'),
        ])
        .where('city_id', '=', q.cityId)
        .executeTakeFirstOrThrow()) as IssueCountRow;
      return {
        cityId: q.cityId,
        last7d: Number(r.last7d),
        last30d: Number(r.last30d),
        all: Number(r.all),
      };
    });
  }
}
