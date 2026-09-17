import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { I18nController } from './i18n.controller.js';
import { I18nService } from './i18n.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [I18nController],
  providers: [I18nService],
})
export class I18nModule {}