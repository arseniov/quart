import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor — see queue.module.ts for precedent.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
import { parseValkeyUrl } from '../queue/connection.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QueueService } from '../queue/queue.service.js';

import { NOTIFICATION_DELIVERIES_SWEEP_JOB } from './notification-deliveries.sweeper.js';
// Value import — vitest's decorator-metadata plugin needs the symbol at
// runtime to emit `design:paramtypes` for the constructor.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { NotificationDeliveriesSweeper } from './notification-deliveries.sweeper.js';

/** Owns the periodic BullMQ trigger that drives {@link NotificationDeliveriesSweeper}.
 *  Mirrors AuditAnchorWorkerHost (T35): one cron + a small `cleanup`-queue
 *  worker that dispatches by job-name and ignores the PII rotation jobs. The
 *  sweep itself is in a separate class so the unit tests can exercise it
 *  without booting BullMQ. */
@Injectable()
export class NotificationDeliveriesSweeperCron implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationDeliveriesSweeperCron.name);
  private worker: Worker | null = null;

  constructor(
    private readonly queues: QueueService,
    private readonly sweeper: NotificationDeliveriesSweeper,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queues.addRepeatable(
      'cleanup',
      NOTIFICATION_DELIVERIES_SWEEP_JOB,
      { trigger: 'cron' },
      { repeat: { pattern: '*/5 * * * *', tz: 'UTC' }, jobId: NOTIFICATION_DELIVERIES_SWEEP_JOB },
    );
    this.worker = new Worker(
      'cleanup',
      async (job) => {
        if (job.name !== NOTIFICATION_DELIVERIES_SWEEP_JOB) return;
        await this.sweeper.sweep();
      },
      { connection: parseValkeyUrl(this.config.env.VALKEY_URL) },
    );
    this.logger.log('notification-deliveries sweeper registered (every 5 min)');
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}