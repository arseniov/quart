import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from './public.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TwilioService } from './twilio.service.js';

const phoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{10,15}$/, 'E.164 phone format required'),
});
const verifySchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/, '6-digit code required'),
});

/**
 * Phone OTP request/verify. Twilio's Verify API generates + delivers the
 * code server-side, so we proxy straight to it instead of routing through
 * Better Auth's `sendPhoneNumberOTP` plugin call (which would require a
 * `sendOTP` callback to be wired — Twilio Verify handles delivery itself).
 *
 * The `phoneNumber()` plugin is registered in `AuthService` so BA still
 * understands the `user.phoneNumber` / `user.phoneNumberVerified` columns
 * from migration 0025; future tasks can wire BA-side session issuance once
 * a logged-in user context is available.
 */
@Controller('auth/phone')
@ApiTags('auth/phone')
@Public()
export class PhoneOtpController {
  constructor(private readonly twilio: TwilioService) {}

  // Per-handler override of the global `phone` throttler. The phone
  // throttler is keyed by phoneNumber (fallback IP) — the limit is 5/min
  // by default; raising it here would defeat the brute-force protection.
  @Post('request')
  @Throttle({ phone: { limit: 5, ttl: 60_000 } })
  async requestOtp(@Body() body: unknown) {
    const { phoneNumber } = phoneSchema.parse(body);
    await this.twilio.sendOtp(phoneNumber);
    return { ok: true };
  }

  @Post('verify')
  @Throttle({ phone: { limit: 5, ttl: 60_000 } })
  async verifyOtp(@Body() body: unknown) {
    const { phoneNumber, code } = verifySchema.parse(body);
    const verified = await this.twilio.verifyOtp(phoneNumber, code);
    return { verified };
  }
}
