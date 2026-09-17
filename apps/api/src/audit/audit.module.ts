import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';
import { VerifyController } from './verify.controller.js';

@Module({
  // forwardRef — AuthModule imports AuditModule for SignOutService's
  // audit.write() call, and AuditModule imports AuthModule for
  // JwtAuthGuard. The two bind at module-resolution time; the cycle
  // is structural, not a runtime ordering bug.
  imports: [forwardRef(() => AuthModule)],
  controllers: [VerifyController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}