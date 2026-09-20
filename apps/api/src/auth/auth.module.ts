import { Module, forwardRef } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
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
import { PasswordResetController } from './password-reset.controller.js';
import { logMailer as logMailerPwd, PASSWORD_RESET_MAILER, PasswordResetService } from './password-reset.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { PhoneOtpService } from './phone-otp.service.js';
import { SignOutController } from './sign-out.controller.js';
import { SignOutService } from './sign-out.service.js';
import { TwilioService } from './twilio.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  imports: [DbModule, forwardRef(() => AuditModule)],
  controllers: [AuthController, PhoneOtpController, MfaController, MagicLinkController, PasswordResetController, SignOutController],
  providers: [
    AuthService,
    TwilioService,
    JwtService,
    ValkeyService,
    JwtAuthGuard,
    MfaService,
    MfaGuard,
    MagicLinkService,
    PasswordResetService,
    PhoneOtpService,
    SignOutService,
    // Default mailer is the Pino-logged stub; AuthModule overrides can
    // rebind MAILER to a real SMTP/SES client.
    { provide: MAILER, useValue: logMailer },
    { provide: PASSWORD_RESET_MAILER, useValue: logMailerPwd },
  ],
  exports: [AuthService, JwtService, JwtAuthGuard, ValkeyService, MfaService, MfaGuard, MagicLinkService, PasswordResetService, PhoneOtpService, SignOutService, MAILER],
})
export class AuthModule {}