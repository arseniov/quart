import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { QueueModule } from '../queue/queue.module.js';

import { FanoutService } from './fanout.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [AuthModule, AuditModule, QueueModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, FanoutService],
  exports: [FanoutService],
})
export class NotificationsModule {}
