import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import { UpdateProfileSchema, type UpdateProfileBody } from './self.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SelfService } from './self.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
interface AuthedRequest extends FastifyRequest {
  user: AuthUser;
  tenant: TenantContext;
}

@Controller('self')
@ApiGlobalResponses()
@ApiTags('self')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SelfController {
  constructor(private readonly svc: SelfService) {}

  @Get()
  @RequirePermission('self.read')
  async get(@Req() req: AuthedRequest) {
    return this.svc.get(req.user, req.tenant);
  }

  @Put()
  @RequirePermission('self.write')
  async update(
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileBody,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.update(body, req.user, req.tenant);
  }

  // `export` is a verb; using `/self/export` keeps the URL resource-noun.
  @Get('export')
  @RequirePermission('self.write')
  async exportData(@Req() req: AuthedRequest) {
    return this.svc.exportData(req.user, req.tenant);
  }

  @Post('delete')
  @RequirePermission('self.write')
  async deleteMe(@Req() req: AuthedRequest) {
    return this.svc.deleteMe(req.user, req.tenant);
  }
}
