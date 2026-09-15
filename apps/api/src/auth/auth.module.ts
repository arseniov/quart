import { Module } from '@nestjs/common';

import { DbModule } from '../db/db.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtService } from './jwt.service.js';
import { MagicLinkController } from './magic-link.controller.js';
import { logMailer, MAILER, MagicLinkService } from './magic-link.service.js';
import { MfaController } from './mfa.controller.js';
import { MfaGuard } from './mfa.guard.js';
import { MfaService } from './mfa.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { TwilioService } from './twilio.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  imports: [DbModule],
  controllers: [AuthController, PhoneOtpController, MfaController, MagicLinkController],
  providers: [
    AuthService,
    TwilioService,
    JwtService,
    ValkeyService,
    JwtAuthGuard,
    MfaService,
    MfaGuard,
    MagicLinkService,
    // Default mailer is the Pino-logged stub; AuthModule overrides can
    // rebind MAILER to a real SMTP/SES client.
    { provide: MAILER, useValue: logMailer },
  ],
  exports: [AuthService, JwtService, JwtAuthGuard, ValkeyService, MfaService, MfaGuard, MagicLinkService, MAILER],
})
export class AuthModule {}