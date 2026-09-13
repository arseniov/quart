import { Global, Module } from '@nestjs/common';

import { ConfigService } from '../config/config.service.js';
import { DbService } from '../db/db.service.js';

import { AuditAnchorCron } from './audit-anchor.cron.js';
import { parseValkeyUrl } from './connection.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  providers: [
    {
      provide: QueueService,
      useFactory: (config: ConfigService): QueueService =>
        new QueueService(parseValkeyUrl(config.env.VALKEY_URL)),
      inject: [ConfigService],
    },
    {
      // useFactory + explicit inject keeps the DI graph testable: vitest's
      // `Test.createTestingModule` can override `QueueService` here without
      // tripping Nest's `design:paramtypes` resolution of the cron class.
      provide: AuditAnchorCron,
      useFactory: (queues: QueueService, config: ConfigService, db: DbService) =>
        new AuditAnchorCron(queues, config, db),
      inject: [QueueService, ConfigService, DbService],
    },
  ],
  exports: [QueueService],
})
export class QueueModule {}