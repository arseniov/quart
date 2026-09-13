import { Global, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Worker } from 'bullmq';

import { ConfigService } from '../config/config.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for AuditAnchorWorkerHost's constructor.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import { startAuditAnchorWorker } from './audit-anchor.worker.js';
import { parseValkeyUrl } from './connection.js';
import { startPiiRotationWorker } from './pii-rotation.worker.js';
import { PushService } from './push.service.js';
import { startPushWorker } from './push.worker.js';
import { QueueService } from './queue.service.js';

/** Owns the audit-anchor BullMQ worker + its repeatable schedule.
 *  The handler computes the AnchorRange from live `audit_log` so the
 *  repeatable payload is just a trigger — see auditAnchorHandler. Export
 *  this class so tests can override it via Test.createTestingModule
 *  (otherwise constructing a Worker would race to talk to Valkey). */
@Injectable()
export class AuditAnchorWorkerHost implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AuditAnchorWorkerHost.name);
  private worker!: Worker;

  constructor(
    private readonly queues: QueueService,
    private readonly config: ConfigService,
    private readonly db: DbService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queues.addRepeatable(
      'audit-anchor',
      'anchor',
      { entity_id: 'audit-anchor-daily', delivery_channel: 'tsa' },
      { repeat: { pattern: '0 2 * * *', tz: 'UTC' }, jobId: 'audit-anchor-daily' },
    );
    this.worker = startAuditAnchorWorker({ config: this.config, db: this.db });
    this.logger.log('audit-anchor worker started (daily 02:00 UTC)');
  }

  async onApplicationShutdown(): Promise<void> {
    // T34 review fix precedent: close BullMQ Worker cleanly so the connection
    // pool drains and a SIGTERM in prod doesn't leave jobs stuck in `active`.
    if (this.worker) await this.worker.close();
  }
}

/** Owns the PII key-rotation BullMQ worker. Unlike AuditAnchorWorkerHost
 *  this does NOT register a repeatable — rotation is platform-initiated
 *  (admin endpoint / CLI), not cron-driven. The worker stays attached so a
 *  manually-enqueued `rotate_pii_keys` job is drained immediately.
 *  Exported so tests can override it via Test.createTestingModule (otherwise
 *  constructing a Worker would race to talk to Valkey). */
@Injectable()
export class PiiRotationWorkerHost implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PiiRotationWorkerHost.name);
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly db: DbService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = startPiiRotationWorker({ config: this.config, db: this.db });
    this.logger.log('pii-rotation worker started (manual trigger via cleanup queue)');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}

/** Owns the Expo push BullMQ worker. No repeatable — pushes are platform-
 *  initiated via the fan-out worker (T38). The worker stays attached so an
 *  enqueued `send_push` job is drained immediately. Exported so tests can
 *  override it via Test.createTestingModule (otherwise constructing a Worker
 *  would race to talk to Valkey). */
@Injectable()
export class PushWorkerHost implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PushWorkerHost.name);
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly push: PushService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = startPushWorker({ config: this.config, push: this.push });
    this.logger.log('push worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: QueueService,
      useFactory: (config: ConfigService): QueueService =>
        new QueueService(parseValkeyUrl(config.env.VALKEY_URL)),
      inject: [ConfigService],
    },
    PushService,
    AuditAnchorWorkerHost,
    PiiRotationWorkerHost,
    PushWorkerHost,
  ],
  exports: [QueueService, PushService],
})
export class QueueModule {}
