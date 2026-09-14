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
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  SaveItemSchema,
  SavedItemIdSchema,
  type SaveItemBody,
} from './saved-items.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SavedItemsService } from './saved-items.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
interface AuthedRequest extends FastifyRequest {
  user: AuthUser;
  tenant: TenantContext;
}

@Controller('saved-items')
@ApiGlobalResponses()
@ApiTags('saved-items')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RbacGuard)
export class SavedItemsController {
  constructor(private readonly svc: SavedItemsService) {}

  @Get()
  @RequirePermission('saved.read')
  async list(@Req() req: AuthedRequest) {
    return this.svc.list(req.tenant);
  }

  @Post()
  @RequirePermission('saved.write')
  async save(
    @Body(new ZodValidationPipe(SaveItemSchema)) body: SaveItemBody,
    @Req() req: AuthedRequest,
  ) {
    const row = await this.svc.save(body, req.user, req.tenant);
    return { ok: true, id: row.id };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('saved.write')
  async remove(
    @Param('id', new ZodValidationPipe(SavedItemIdSchema.shape.id)) id: string,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.svc.remove(id, req.user, req.tenant);
  }
}
