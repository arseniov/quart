import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  CommentCreateSchema,
  CreateSchema,
  IdSchema,
  ListSchema,
  ModerateSchema,
  UpdateSchema,
} from './ideas.dto.js';
import type {
  CommentCreateBody,
  CreateBody,
  ListQuery,
  ModerateBody,
  UpdateBody,
} from './ideas.dto.js';
import type { Idea, IdeaComment } from './ideas.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the IdeasService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { IdeasService } from './ideas.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
// Class-level guards apply to every route. Public read endpoints (list/get)
// use @Public-decorated equivalents via @RequirePermission which the
// RbacGuard treats as "no requirement → allow" when user is set. JwtAuthGuard
// populates req.user from the bearer token; ideas are scoped per-city via
// the tenant context the interceptor already wired.
@Controller('ideas')
@ApiGlobalResponses()
@ApiTags('ideas')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class IdeasController {
  constructor(private readonly svc: IdeasService) {}

  @Get()
  @RequirePermission('content.read')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListSchema)) q: ListQuery,
  ): Promise<Idea[]> {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermission('content.read')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<Idea> {
    return this.svc.get(user, id);
  }

  // Citizens create their own ideas (content.create). Admins can also create
  // — service still stamps author_user_id from `user.id`.
  @Post()
  @RequirePermission('content.create')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSchema)) body: CreateBody,
  ): Promise<Idea> {
    return this.svc.create(user, body);
  }

  // Author OR admin. The class-level RbacGuard does not constrain by
  // permission code here; instead we accept any authenticated user and
  // check ownership in the service. This avoids leaking the permission
  // taxonomy to citizens while still letting moderators/quart_admin edit.
  @Put(':id')
  @RequirePermission('content.create')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(UpdateSchema)) body: UpdateBody,
  ): Promise<Idea> {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('content.create')
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<void> {
    await this.svc.delete(user, id);
  }

  // Vote toggles: idempotent insert. Re-clicking POST is a no-op (vote()).
  // To retract, DELETE /ideas/:id/vote.
  @Post(':id/vote')
  @RequirePermission('content.create')
  async vote(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<{ ideaId: string; userId: string; upvoted: true }> {
    return this.svc.vote(user, id);
  }

  @Delete(':id/vote')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('content.create')
  async unvote(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<void> {
    await this.svc.unvote(user, id);
  }

  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin.ideas.moderate')
  async moderate(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(ModerateSchema)) body: ModerateBody,
  ): Promise<{ id: string; status: 'published' | 'hidden' | 'rejected' }> {
    return this.svc.moderate(user, id, body);
  }

  @Get(':id/comments')
  @RequirePermission('content.read')
  async listComments(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<IdeaComment[]> {
    return this.svc.listComments(user, id);
  }

  @Post(':id/comments')
  @RequirePermission('content.create')
  async createComment(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(CommentCreateSchema)) body: CommentCreateBody,
  ): Promise<{ id: string; parentType: 'idea'; parentId: string; authorUserId: string; body: string }> {
    return this.svc.createComment(user, id, body);
  }
}
