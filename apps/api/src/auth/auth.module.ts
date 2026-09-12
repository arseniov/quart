import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtService } from './jwt.service.js';
import { MfaController } from './mfa.controller.js';
import { MfaService } from './mfa.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { TwilioService } from './twilio.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  imports: [DbModule],
  controllers: [AuthController, PhoneOtpController, MfaController],
  providers: [AuthService, TwilioService, JwtService, ValkeyService, JwtAuthGuard, MfaService],
  exports: [AuthService, JwtService, JwtAuthGuard, ValkeyService, MfaService],
})
export class AuthModule {}