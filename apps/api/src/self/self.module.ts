import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { SelfController } from './self.controller.js';
import { SelfService } from './self.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SelfController],
  providers: [SelfService],
})
export class SelfModule {}
