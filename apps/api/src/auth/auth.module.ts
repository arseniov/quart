import { Module, forwardRef } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { DbModule } from '../db/db.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BaAuthGuard } from './ba-auth.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtService } from './jwt.service.js';
import { LoginController } from './login.controller.js';
import { LoginService } from './login.service.js';
import { MagicLinkController } from './magic-link.controller.js';
import { logMailer, MAILER, MagicLinkService } from './magic-link.service.js';
import { MfaController } from './mfa.controller.js';
import { MfaGuard } from './mfa.guard.js';
import { MfaService } from './mfa.service.js';
import { PasswordResetController } from './password-reset.controller.js';
import { logMailer as logMailerPwd, PASSWORD_RESET_MAILER, PasswordResetService } from './password-reset.service.js';
import { PhoneOtpController } from './phone-otp.controller.js';
import { PhoneOtpService } from './phone-otp.service.js';
import { SessionService } from './session.service.js';
import { SignOutController } from './sign-out.controller.js';
import { SignOutService } from './sign-out.service.js';
import { TwilioService } from './twilio.service.js';
import { ValkeyService } from './valkey.service.js';

@Module({
  imports: [DbModule, forwardRef(() => AuditModule)],
  // LoginController is registered AFTER AuthController so the explicit
  // `/auth/login` route wins over the BA wildcard proxy (`/auth/*`).
  controllers: [AuthController, PhoneOtpController, MfaController, MagicLinkController, PasswordResetController, SignOutController, LoginController],
  providers: [
    AuthService,
    TwilioService,
    JwtService,
    ValkeyService,
    JwtAuthGuard,
    BaAuthGuard,
    MfaService,
    MfaGuard,
    MagicLinkService,
    PasswordResetService,
    PhoneOtpService,
    LoginService,
    SessionService,
    SignOutService,
    // Default mailer is the Pino-logged stub; AuthModule overrides can
    // rebind MAILER to a real SMTP/SES client.
    { provide: MAILER, useValue: logMailer },
    { provide: PASSWORD_RESET_MAILER, useValue: logMailerPwd },
  ],
  exports: [AuthService, JwtService, JwtAuthGuard, BaAuthGuard, ValkeyService, MfaService, MfaGuard, MagicLinkService, PasswordResetService, PhoneOtpService, LoginService, SessionService, SignOutService, MAILER],
})
export class AuthModule {}