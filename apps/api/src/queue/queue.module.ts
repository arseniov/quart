import { Global, Module } from '@nestjs/common';

import { ConfigService } from '../config/config.service.js';

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
  ],
  exports: [QueueService],
})
export class QueueModule {}