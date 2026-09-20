import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { BaAuthGuard } from '../auth/ba-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  CastVoteInput,
  CreatePollInput,
  ListPollsQuery,
  PollIdParam,
  UpdatePollInput,
} from './polls.dto.js';
import type { CreateBody, ListQuery, UpdateBody, VoteBody } from './polls.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the PollsService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PollsService } from './polls.service.js';
import type { Poll } from './polls.service.js';

@Controller('polls')
@ApiGlobalResponses()
@ApiTags('polls')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, MfaGuard, RbacGuard)
export class PollsController {
  constructor(private readonly svc: PollsService) {}

  @Get()
  @RequirePermission('content.read')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(ListPollsQuery)) q: ListQuery): Promise<Poll[]> {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermission('content.read')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(PollIdParam.shape.id)) id: string,
  ) {
    return this.svc.get(user, id);
  }

  @Post()
  @RequirePermission('admin.polls.create')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreatePollInput)) body: CreateBody) {
    return this.svc.create(user, body);
  }

  @Put(':id')
  @RequirePermission('admin.polls.create')
  async update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(PollIdParam.shape.id)) id: string,
    @Body(new ZodValidationPipe(UpdatePollInput)) body: UpdateBody,
  ): Promise<Poll> {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('admin.polls.create')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(PollIdParam.shape.id)) id: string,
  ): Promise<void> {
    await this.svc.delete(user, id);
  }

  @Post(':id/publish')
  @RequirePermission('admin.polls.publish')
  async publish(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(PollIdParam.shape.id)) id: string,
  ): Promise<Poll> {
    return this.svc.publish(user, id);
  }

  @Post(':id/vote')
  @RequirePermission('polls.vote')
  async vote(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(PollIdParam.shape.id)) id: string,
    @Body(new ZodValidationPipe(CastVoteInput)) body: VoteBody,
  ): Promise<{ ok: true }> {
    await this.svc.vote(user, id, body);
    return { ok: true };
  }
}
