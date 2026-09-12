import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

const PollCreateSchema = z.object({
  cityId: z.string().uuid(),
  titleI18n: z.record(z.string(), z.string()),
  body: z.string().optional(),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  options: z.array(z.object({ label: z.record(z.string(), z.string()) })).min(2),
});

const PollPatchSchema = z.object({
  titleI18n: z.record(z.string(), z.string()).optional(),
  closesAt: z.coerce.date().optional(),
});

@Controller('admin/polls')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminPollsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.polls.publish')
  async list() {
    return this.db.kysely.selectFrom('polls').selectAll().execute();
  }

  @Post()
  @RequirePermission('admin.polls.create')
  async create(
    @Body(new ZodValidationPipe(PollCreateSchema)) body: z.infer<typeof PollCreateSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const row = await trx
        .insertInto('polls')
        .values({
          city_id: body.cityId,
          title: body.titleI18n,
          body: body.body ?? null,
          opens_at: body.opensAt,
          closes_at: body.closesAt,
          status: 'draft',
          created_by_user_id: user.id,
        } as never)
        .returning('id')
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'poll.create',
        targetType: 'poll',
        targetId: (row as { id: string }).id,
        payload: { title: body.titleI18n },
      });

      return { id: (row as { id: string }).id };
    });
  }

  @Patch(':id')
  @RequirePermission('admin.polls.create')
  async patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PollPatchSchema)) body: z.infer<typeof PollPatchSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const patch: Record<string, unknown> = {};
      if (body.titleI18n !== undefined) patch['title'] = body.titleI18n;
      if (body.closesAt !== undefined) patch['closes_at'] = body.closesAt;

      await trx.updateTable('polls').set(patch).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'poll.update',
        targetType: 'poll',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });
      return { ok: true };
    });
  }

  @Post(':id/close')
  @RequirePermission('admin.polls.publish')
  async close(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await trx.updateTable('polls').set({ status: 'closed' }).where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'poll.close',
        targetType: 'poll',
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
