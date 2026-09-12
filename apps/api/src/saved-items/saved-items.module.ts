import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { SavedItemsController } from './saved-items.controller.js';
import { SavedItemsService } from './saved-items.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SavedItemsController],
  providers: [SavedItemsService],
})
export class SavedItemsModule {}
