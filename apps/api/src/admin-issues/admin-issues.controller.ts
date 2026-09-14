import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { TenantContext } from '../db/run-in-tenant-tx.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import {
  AdminIssueBulkAssign,
  AdminIssueBulkStatus,
  AdminIssueExportQuery,
  AdminIssueListQuery,
} from './admin-issues.dto.js';
import type {
  AdminIssueBulkAssignBody,
  AdminIssueBulkStatusBody,
  AdminIssueExportQueryT,
  AdminIssueListQueryT,
} from './admin-issues.dto.js';
import type { AdminIssue } from './admin-issues.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AdminIssuesService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AdminIssuesService } from './admin-issues.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

interface AuthedRequest extends FastifyRequest {
  user: AuthUser;
  tenant: TenantContext;
}

@Controller('admin/issues')
@ApiTags('admin/issues')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminIssuesController {
  constructor(private readonly svc: AdminIssuesService) {}

  @Get()
  @RequirePermission('admin.issues.read')
  async list(
    @Query(new ZodValidationPipe(AdminIssueListQuery)) q: AdminIssueListQueryT,
  ): Promise<AdminIssue[]> {
    return this.svc.list(q);
  }

  @Get('map')
  @RequirePermission('admin.issues.read')
  async map(
    @Query(new ZodValidationPipe(AdminIssueListQuery)) q: AdminIssueListQueryT,
  ): ReturnType<AdminIssuesService['map']> {
    return this.svc.map(q);
  }

  // text/csv per RFC 4180. The filename is static (the URL slug is
  // sufficient for browser download UX); downstream tools can rename on
  // save. The Content-Disposition inline keeps curl/proxies from forcing a
  // download dialog during local testing.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="issues.csv"')
  @RequirePermission('admin.issues.read')
  async export(
    @Query(new ZodValidationPipe(AdminIssueExportQuery)) q: AdminIssueExportQueryT,
  ): Promise<string> {
    return this.svc.export(q);
  }

  @Post('status/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin.issues.status')
  async bulkStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AdminIssueBulkStatus)) body: AdminIssueBulkStatusBody,
    @Req() req: AuthedRequest,
  ): Promise<{ updated: number }> {
    return this.svc.bulkChangeStatus(body, user, req.tenant);
  }

  @Post('assign/bulk')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin.issues.assign')
  async bulkAssign(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AdminIssueBulkAssign)) body: AdminIssueBulkAssignBody,
    @Req() req: AuthedRequest,
  ): Promise<{ updated: number }> {
    return this.svc.bulkAssign(body, user, req.tenant);
  }
}
