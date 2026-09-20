import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  AssignSchema,
  AttachPhotoSchema,
  CreateSchema,
  IdSchema,
  ListSchema,
  StatusSchema,
} from './issues.dto.js';
import type {
  AssignBody,
  AttachPhotoBody,
  CreateBody,
  ListQuery,
  StatusBody,
} from './issues.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the IssuesService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { IssuesService } from './issues.service.js';
import type { Issue, IssueEvent, IssuePhoto } from './issues.service.js';

@Controller('issues')
@ApiGlobalResponses()
@ApiTags('issues')
@ApiBearerAuth('bearer')
@UseGuards(BaAuthGuard, MfaGuard, RbacGuard)
export class IssuesController {
  constructor(private readonly svc: IssuesService) {}

  @Get()
  @RequirePermission('content.read')
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListSchema)) q: ListQuery,
  ): Promise<Issue[]> {
    return this.svc.list(user, q);
  }

  @Get(':id')
  @RequirePermission('content.read')
  async getById(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
  ): Promise<{ issue: Issue; photos: IssuePhoto[]; events: IssueEvent[] }> {
    return this.svc.get(user, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('issues.create')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateSchema)) body: CreateBody,
  ): Promise<{ id: string; neighborhoodId: string }> {
    return this.svc.create(user, body);
  }

  @Patch(':id/status')
  @RequirePermission('admin.issues.status')
  async changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: StatusBody,
  ): Promise<Issue> {
    return this.svc.changeStatus(user, id, body);
  }

  @Post(':id/assign')
  @RequirePermission('admin.issues.assign')
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) id: string,
    @Body(new ZodValidationPipe(AssignSchema)) body: AssignBody,
  ): Promise<Issue> {
    return this.svc.assign(user, id, body);
  }

  // TODO(phase-6): wire multipart upload + presigned PUT to object store.
  // For now we validate the JSON envelope so the route exists and the
  // RBAC gate is in place; Phase 6 swaps the body parser and adds a
  // direct-to-storage upload flow before persisting object_key.
  @Post(':id/photos')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('issues.create')
  async attachPhoto(
    @CurrentUser() _user: AuthUser,
    @Param('id', new ZodValidationPipe(IdSchema.shape.id)) _id: string,
    @Body(new ZodValidationPipe(AttachPhotoSchema)) _body: AttachPhotoBody,
  ): Promise<{ ok: true; todo: 'phase-6' }> {
    return { ok: true, todo: 'phase-6' };
  }
}
