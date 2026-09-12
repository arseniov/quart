import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { VerifyController } from './verify.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [VerifyController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}