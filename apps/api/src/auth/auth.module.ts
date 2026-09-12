import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtService } from './jwt.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { TwilioService } from './twilio.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  imports: [DbModule],
  controllers: [AuthController, PhoneOtpController],
  providers: [AuthService, TwilioService, JwtService, ValkeyService, JwtAuthGuard],
  exports: [AuthService, JwtService, JwtAuthGuard, ValkeyService],
})
export class AuthModule {}