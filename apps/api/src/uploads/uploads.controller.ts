import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@quart/shared-types';
import type { FastifyRequest } from 'fastify';

import type { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService constructor parameter.
 
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the UploadsService constructor parameter.
 
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";

import type { UploadsService } from './uploads.service.js';

/**
 * Fastify multipart — `main.ts` registers `@fastify/multipart` globally and
 * `req.file()` yields the first part. We pass `limits.fileSize` so busboy
 * rejects mid-stream (DoS surface), not after buffering — the post-buffer
 * check in the service is defense in depth.
 */
const TEN_MB = 10 * 1024 * 1024;

@Controller('uploads')
@ApiGlobalResponses()
@ApiTags('uploads')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
    private readonly db: DbService,
  ) {}

  @Post('issue-photo')
  @HttpCode(HttpStatus.CREATED)
  async issuePhoto(
    @Req() req: FastifyRequest,
    @CurrentUser() user: AuthUser,
    @CurrentTenant() tenant: TenantContext | null,
  ): Promise<{ objectKey: string; mime: string }> {
    if (!tenant) {
      // TenantContextInterceptor only populates `tenant` when X-City-Id is
      // present and valid. Uploads are city-scoped (private bucket is
      // per-city) so we refuse tenantless requests explicitly — defense in
      // depth even though the interceptor should always populate it.
      throw new BadRequestException({
        error: { code: 'upload.no_tenant', message: 'tenant context required' },
      });
    }

    const part = await req.file({ limits: { fileSize: TEN_MB } });
    if (!part) {
      throw new BadRequestException({
        error: { code: 'upload.no_file', message: 'multipart field "file" missing' },
      });
    }
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);

    // Upload + audit in the same tx so any future DB write (e.g.
    // issue_photos insert) joins the same audit row.
    const { objectKey, mime } = await this.db.runInTenantTx(tenant, async (trx) => {
      const r = await this.uploads.process(buf);
      await this.audit.write(trx, {
        tenant,
        action: 'photo.upload',
        targetType: 'photo',
        targetId: r.objectKey,
        payload: { mime: r.mime, bytes: r.bytes.byteLength, user_id: user.id },
      });
      return r;
    });

    return { objectKey, mime };
  }
}
