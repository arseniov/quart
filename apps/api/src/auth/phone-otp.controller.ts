import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RequestOtpSchema, VerifyOtpSchema, type VerifyOtpResult } from './phone-otp.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameters.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PhoneOtpService, extractVerifyContext } from './phone-otp.service.js';
import { Public } from './public.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TwilioService } from './twilio.service.js';

interface VerifyFastifyRequest {
  id?: string | number;
  raw?: { id?: string | number };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Phone OTP request/verify. Twilio's Verify API generates + delivers the
 * code server-side, so we proxy straight to it instead of routing through
 * Better Auth's `sendPhoneNumberOTP` plugin call (which would require a
 * `sendOTP` callback to be wired — Twilio Verify handles delivery itself).
 *
 * The `phoneNumber()` plugin is registered in `AuthService` so BA still
 * understands the `user.phoneNumber` / `user.phoneNumberVerified` columns
 * from migration 0025.
 *
 * GH #45: /verify no longer issues JWTs — the response shape is the
 * Quart user projection only. Callers needing bearer auth use BA's own
 * endpoints.
 */
@Controller('auth/phone')
@ApiTags('auth/phone')
@Public()
export class PhoneOtpController {
  constructor(
    private readonly twilio: TwilioService,
    private readonly service: PhoneOtpService,
  ) {}

  // Per-handler override of the global `phone` throttler. The phone
  // throttler is keyed by phoneNumber (fallback IP) — the limit is 5/min
  // by default; raising it here would defeat the brute-force protection.
  @Post('request')
  @Throttle({ phone: { limit: 5, ttl: 60_000 } })
  async requestOtp(@Body() body: unknown) {
    const { phoneNumber } = RequestOtpSchema.parse(body);
    await this.twilio.sendOtp(phoneNumber);
    return { ok: true };
  }

  /**
   * Verify the OTP + write the §3.8 audit chain row (`session_created`)
   * in one round trip. Returns the Quart user projection.
   *
   * Status codes:
   *   200 — OTP matched.
   *   422 — code is malformed, expired, or wrong (`phone_otp.invalid_code`).
   *   401 — OTP matched but no Quart user exists for that phone
   *         (`phone_otp.unknown_user`); same response shape as wrong-code
   *         to avoid leaking which phone numbers are registered.
   *   429 — throttled (per-phone bucket; see `throttler.config.ts`).
   */
  @Post('verify')
  @ApiOkResponse({
    description: 'OTP verified. Returns the Quart user projection.',
    schema: {
      type: 'object',
      required: ['user'],
      properties: {
        user: {
          type: 'object',
          required: [
            'id',
            'handle',
            'display_name',
            'email',
            'phone_e164',
            'avatar_url',
            'preferred_locale',
            'city_id',
            'needs_onboarding',
            'roles',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            handle: { type: 'string' },
            display_name: { type: 'string' },
            email: { type: 'string', nullable: true },
            phone_e164: { type: 'string', nullable: true },
            avatar_url: { type: 'string', nullable: true },
            preferred_locale: { type: 'string' },
            city_id: { type: 'string', format: 'uuid', nullable: true },
            needs_onboarding: { type: 'boolean' },
            roles: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  })
  @ApiUnprocessableEntityResponse({ description: 'OTP code is invalid or expired.' })
  @Throttle({ phone: { limit: 5, ttl: 60_000 } })
  async verifyOtp(
    @Body() body: unknown,
    @Req() req: VerifyFastifyRequest,
  ): Promise<VerifyOtpResult> {
    const { phoneNumber, code } = VerifyOtpSchema.parse(body);
    const ctx = { ...extractVerifyContext(req), phoneNumber, code };
    return this.service.verifyAndIssueSession(ctx);
  }
}