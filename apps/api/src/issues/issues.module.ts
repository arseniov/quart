import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { IssuesController } from './issues.controller.js';
import { IssuesService } from './issues.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
