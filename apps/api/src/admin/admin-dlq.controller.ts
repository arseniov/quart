import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';
import type { QueueName } from '../queue/queue.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueService } from '../queue/queue.service.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

const Q = z.object({
  queue: z.enum(['push', 'email', 'audit-anchor', 'media-scan', 'cleanup', 'webhooks']),
});

// BullMQ's `Job` shape — narrowed to just what the DLQ viewer exposes.
// ponytail: keep this lean. If we ever surface `data` or `stacktrace` here
// we must redact PII (the email/push jobs carry recipient contact details
// and tokens). Upgrade path: build a per-queue allowlist + a deep-redactor.
interface DlqJob {
  id?: string;
  name?: string;
  attemptsMade?: number;
  failedReason?: string;
  timestamp?: number;
  finishedOn?: number | null;
}

@Controller('admin/dlq')
@ApiGlobalResponses()
@ApiTags('admin/dlq')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class AdminDlqController {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  constructor(private readonly queues: QueueService) {}

  @Get()
  @RequirePermission('admin.dlq.read')
  async list(
    @Query(new ZodValidationPipe(Q)) q: z.infer<typeof Q>,
    @CurrentUser() _user: AuthUser,
  ): Promise<DlqJob[]> {
    const queueMap = (this.queues as unknown as { queues: Record<QueueName, { getJobs: (state: 'failed') => Promise<DlqJob[]> }> })
      .queues;
    return queueMap[q.queue].getJobs('failed');
  }
}