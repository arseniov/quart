import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  ListNotificationsQuerySchema,
  NotificationIdSchema,
  type ListNotificationsQuery,
} from './notifications.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationsService } from './notifications.service.js';

interface AuthedRequest extends FastifyRequest {
  tenant: TenantContext;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard, RbacGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  @RequirePermission('notifications.read')
  async list(
    @Query(new ZodValidationPipe(ListNotificationsQuerySchema)) q: ListNotificationsQuery,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.list(q, req.tenant);
  }

  @Patch(':id/read')
  @RequirePermission('notifications.write')
  async markRead(
    @Param('id', new ZodValidationPipe(NotificationIdSchema.shape.id)) id: string,
    @Req() req: AuthedRequest,
  ) {
    await this.svc.markRead(id, req.tenant);
    return { ok: true };
  }

  // Bulk action — guard by MfaGuard once officer actions become a thing.
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(MfaGuard)
  @RequirePermission('notifications.write')
  async markAllRead(@Req() req: AuthedRequest) {
    const count = await this.svc.markAllRead(req.tenant);
    return { ok: true, count };
  }
}
