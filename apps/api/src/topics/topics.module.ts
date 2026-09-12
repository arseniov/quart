import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TopicsController],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}