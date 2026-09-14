import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import { CreateCommentBody, ListCommentsQuery, ReactBody, UpdateCommentBody } from './comments.dto.js';
import { CommentsService } from './comments.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
interface AuthedRequest extends FastifyRequest {
  user: AuthUser;
  tenant: TenantContext;
}

@Controller('comments')
@ApiGlobalResponses()
@ApiTags('comments')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CommentsController {
  constructor(private readonly svc: CommentsService) {}

  // Read endpoints are gated by `content.read`, which 0021 grants to every
  // role — the permission check is intentional symmetry, not a barrier.
  @Get()
  @RequirePermission('content.read')
  async list(
    @Query(new ZodValidationPipe(ListCommentsQuery)) q: ListCommentsQuery,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.list(q, req.tenant);
  }

  @Get(':id')
  @RequirePermission('content.read')
  async get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.svc.get(id, req.tenant);
  }

  @Post()
  @RequirePermission('content.create')
  async create(
    @Body(new ZodValidationPipe(CreateCommentBody)) body: CreateCommentBody,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.create(body, req.user, req.tenant);
  }

  @Put(':id')
  @UseGuards(MfaGuard)
  @RequirePermission('content.create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCommentBody)) body: UpdateCommentBody,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.update(id, body, req.user, req.tenant);
  }

  @Delete(':id')
  @UseGuards(MfaGuard)
  @RequirePermission('admin.ideas.moderate')
  async delete(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.svc.delete(id, req.user, req.tenant);
    return { ok: true };
  }

  @Post(':id/react')
  @RequirePermission('content.create')
  async react(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReactBody)) body: ReactBody,
    @Req() req: AuthedRequest,
  ) {
    return this.svc.react(id, body, req.user, req.tenant);
  }
}
