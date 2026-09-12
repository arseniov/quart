import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { AdminIssuesController } from './admin-issues.controller.js';
import { AdminIssuesService } from './admin-issues.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminIssuesController],
  providers: [AdminIssuesService],
  exports: [AdminIssuesService],
})
export class AdminIssuesModule {}
