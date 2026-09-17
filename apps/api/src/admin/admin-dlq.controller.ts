import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueService, type DlqJobView } from '../queue/queue.service.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

const QUEUE_VALUES = [
  'push',
  'email',
  'audit-anchor',
  'media-scan',
  'cleanup',
  'webhooks',
] as const;

// Mirror the `QueueName` union in `queue.service.ts`. The cap on `limit`
// is the only thing standing between a curious admin and an unbounded
// Redis scan; the cap on `start` is a sanity bound.
const Q = z.object({
  queue: z.enum(QUEUE_VALUES),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  start: z.coerce.number().int().min(0).default(0),
});

@Controller('admin/dlq')
@ApiGlobalResponses()
@ApiTags('admin/dlq')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminDlqController {
   
  constructor(private readonly queues: QueueService) {}

  @Get()
  @RequirePermission('admin.dlq.read')
  async list(
    @Query(new ZodValidationPipe(Q)) q: z.infer<typeof Q>,
    @CurrentUser() _user: AuthUser,
  ): Promise<DlqJobView[]> {
    // `end` is exclusive in BullMQ — pass `start + limit - 1` so the
    // requested count lands exactly. Cap stays at the Zod layer above.
    return this.queues.getFailedJobs(q.queue, {
      start: q.start,
      end: q.start + q.limit - 1,
    });
  }
}
