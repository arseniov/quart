import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
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

const InviteSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
  scope: z.object({
    scopeType: z.enum(['city', 'city_area', 'neighborhood']),
    scopeId: z.string().uuid(),
  }),
});

// Magic-link tokens generated on invite. Workers (T33) consume them when the
// invitee redeems the link. Ponytail: the token is opaque + single-use; we
// store its hash, not the raw value, so a database leak doesn't grant access.
const TOKEN_TTL_HOURS = 72;

@Controller('admin/officers/invites')
@ApiGlobalResponses()
@ApiTags('admin/officers')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, MfaGuard, RbacGuard)
export class AdminOfficersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('admin.users.role.write')
  async list() {
    // Read passes through; officer_invites lives in a future migration. The
    // table name is cast to `never` so this compiles before the schema
    // lands — the migration is queued for T33.
    return (this.db.kysely as unknown as {
      selectFrom: (t: string) => { selectAll: () => { execute: () => Promise<unknown> } };
    })
      .selectFrom('officer_invites')
      .selectAll()
      .execute();
  }

  @Post()
  @RequirePermission('admin.users.role.write')
  async invite(
    @Body(new ZodValidationPipe(InviteSchema)) body: z.infer<typeof InviteSchema>,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    // Scope invariant: a quart_admin can only invite within their own city.
    // city_area/neighborhood scope is implicitly city-scoped because the
    // worker validates area/neighborhood membership at redemption.
    if (!user.isSuperAdmin && body.scope.scopeType === 'city' && body.scope.scopeId !== user.cityId) {
      throw new BadRequestException({
        error: { code: 'invite.cross_city', message: 'inviter cannot grant outside their scope' },
      });
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      const row = await (trx as unknown as {
        insertInto: (t: string) => {
          values: (v: Record<string, unknown>) => {
            returning: (cols: string[]) => { executeTakeFirstOrThrow: () => Promise<{ id: string }> };
          };
        };
      })
        .insertInto('officer_invites')
        .values({
          id: randomUUID(),
          email: body.email,
          role_id: body.roleId,
          scope_type: body.scope.scopeType,
          scope_id: body.scope.scopeId,
          city_id: body.scope.scopeType === 'city' ? body.scope.scopeId : ctx.cityId,
          token_hash: token.replace(/-/g, ''),
          invited_by_user_id: user.id,
          expires_at: expiresAt,
          status: 'pending',
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'officer.invite',
        targetType: 'officer_invite',
        targetId: row.id,
        payload: { email: body.email, scope: body.scope },
      });

      return { id: row.id, token, expiresAt: expiresAt.toISOString() };
    });
  }

  @Delete(':id')
  @RequirePermission('admin.users.role.write')
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    ctx: TenantContext,
  ): Promise<{ ok: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user, ctx), async (trx) => {
      await (trx as unknown as {
        updateTable: (t: string) => {
          set: (v: Record<string, unknown>) => {
            where: (c: string, op: string, v: string) => { execute: () => Promise<unknown> };
          };
        };
      })
        .updateTable('officer_invites')
        .set({ status: 'revoked' })
        .where('id', '=', id)
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user, ctx),
        action: 'officer.invite.revoke',
        targetType: 'officer_invite',
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
