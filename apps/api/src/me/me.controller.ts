// apps/api/src/me/me.controller.ts
// GH #51: POST/DELETE/GET /me/devices.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { BaAuthGuard } from '../auth/ba-auth.guard.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  DeviceIdSchema,
  RegisterDeviceSchema,
  type RegisterBody,
} from './me.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MeService } from './me.service.js';

interface AuthedRequest extends FastifyRequest {
  user: AuthUser;
  tenant: TenantContext;
}

@Controller('me/devices')
@ApiGlobalResponses()
@ApiTags('me-devices')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, RbacGuard)
export class MeDevicesController {
  constructor(private readonly svc: MeService) {}

  @Get()
  @RequirePermission('notifications.write')
  async list(@Req() req: AuthedRequest) {
    const rows = await this.svc.list(req.user, req.tenant);
    return { devices: rows };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('notifications.write')
  async register(
    @Body(new ZodValidationPipe(RegisterDeviceSchema)) body: RegisterBody,
    @Req() req: AuthedRequest,
  ) {
    const row = await this.svc.register(body, req.user, req.tenant);
    return { ok: true, id: row.id, deviceId: row.deviceId };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('notifications.write')
  async revoke(
    @Param('id', new ZodValidationPipe(DeviceIdSchema.shape.id)) id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.svc.revoke(id, req.user, req.tenant);
  }
}