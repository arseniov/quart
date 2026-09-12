import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}