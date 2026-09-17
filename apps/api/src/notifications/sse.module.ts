import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ConfigService } from '../config/config.service.js';

import { NotificationsSubscriber, VALKEY_URL } from './notifications-subscriber.service.js';
import { SseController } from './sse.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SseController],
  providers: [
    NotificationsSubscriber,
    {
      provide: VALKEY_URL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string => config.env.VALKEY_URL,
    },
  ],
})
export class SseModule {}
