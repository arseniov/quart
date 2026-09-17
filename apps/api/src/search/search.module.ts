import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}