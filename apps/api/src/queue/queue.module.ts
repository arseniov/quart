import { Global, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Worker } from 'bullmq';

import { ConfigService } from '../config/config.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for AuditAnchorWorkerHost's constructor.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import { startAuditAnchorWorker } from './audit-anchor.worker.js';
import { parseValkeyUrl } from './connection.js';
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

@Global()
@Module({
  providers: [
    {
      provide: QueueService,
      useFactory: (config: ConfigService): QueueService =>
        new QueueService(parseValkeyUrl(config.env.VALKEY_URL)),
      inject: [ConfigService],
    },
    AuditAnchorWorkerHost,
  ],
  exports: [QueueService],
})
export class QueueModule {}
