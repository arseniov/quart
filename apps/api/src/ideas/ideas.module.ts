import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { IdeasController } from './ideas.controller.js';
import { IdeasService } from './ideas.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [IdeasController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}