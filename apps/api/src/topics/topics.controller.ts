import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import { CreateSchema, IdSchema, ListSchema, UpdateSchema } from './topics.dto.js';
import type { CreateBody, ListQuery, UpdateBody } from './topics.dto.js';
import type { Topic } from './topics.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the TopicsService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TopicsService } from './topics.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
@Controller('topics')
@ApiGlobalResponses()
@ApiTags('topics')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class TopicsController {
  constructor(private readonly svc: TopicsService) {}

  @Get()
  @RequirePermission('content.read')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListSchema)) q: ListQuery,
  ): Promise<Topic[]> {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermission('content.read')
  async getById(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<Topic> {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermission('admin.taxonomy.write')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSchema)) body: CreateBody,
  ): Promise<Topic> {
    return this.svc.create(user, body);
  }

  @Put(':id')
  @RequirePermission('admin.taxonomy.write')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(UpdateSchema)) body: UpdateBody,
  ): Promise<Topic> {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('admin.taxonomy.write')
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<void> {
    await this.svc.delete(user, id);
  }
}
