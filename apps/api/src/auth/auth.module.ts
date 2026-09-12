import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { TwilioService } from './twilio.service.js';

@Module({
  imports: [DbModule],
  controllers: [AuthController, PhoneOtpController],
  providers: [AuthService, TwilioService],
  exports: [AuthService],
})
export class AuthModule {}