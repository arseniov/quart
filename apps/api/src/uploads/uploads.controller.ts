import type { Readable } from 'node:stream';

import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TenantContext } from '@quart/shared-types';

import { CurrentTenant } from '../common/decorators/current-tenant.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the UploadsService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UploadsService } from './uploads.service.js';

/**
 * Fastify multipart — `main.ts` registers `@fastify/multipart` globally and
 * `req.file()` yields the first part. Type narrowed via an inline cast since
 * `@fastify/multipart`'s augmentation isn't loaded by `@types/fastify` here.
 */
interface FastifyMultipartRequest extends FastifyRequest {
  file: () => Promise<{ file: Readable; mimetype: string; filename?: string }>;
}

@Controller('uploads')
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
    @Req() req: FastifyMultipartRequest,
    @CurrentUser() user: AuthUser,
    @CurrentTenant() tenant: TenantContext | null,
  ): Promise<{ objectKey: string; mime: string }> {
    if (!tenant) {
      // TenantContextInterceptor only populates `tenant` when X-City-Id is
      // present and valid. Uploads are city-scoped (private bucket is
      // per-city) so we refuse tenantless requests explicitly.
      throw new Error('tenant context required');
    }

    const part = await req.file();
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);

    // Upload + audit in the same tx so any future DB write (e.g.
    // issue_photos insert) joins the same audit row.
    const { objectKey, mime } = await this.db.runInTenantTx(tenant, async (trx) => {
      const r = await this.uploads.process(buf, part.mimetype);
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