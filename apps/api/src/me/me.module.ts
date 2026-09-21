// apps/api/src/me/me.module.ts
// GH #51: /me/devices endpoints.

import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';

import { MeDevicesController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [MeDevicesController],
  providers: [MeService],
})
export class MeModule {}