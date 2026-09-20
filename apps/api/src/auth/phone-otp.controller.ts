import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import type { VerifyOtpSessionResponse } from './phone-otp.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameters.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PhoneOtpService, extractVerifyContext } from './phone-otp.service.js';
import { Public } from './public.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TwilioService } from './twilio.service.js';

const phoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{10,15}$/, 'E.164 phone format required'),
});
const verifySchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/, '6-digit code required'),
});

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
 * from migration 0025; the verify path runs our own session-issuance flow
 * (GH #30) instead of routing through BA's `signInPhoneNumber`, which
 * requires a password — single-step UX was the whole point.
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
    const { phoneNumber } = phoneSchema.parse(body);
    await this.twilio.sendOtp(phoneNumber);
    return { ok: true };
  }

  /**
   * Verify the OTP + issue a session in one round trip (GH #30, Option A).
   * Response shape mirrors the (forthcoming) email-login contract:
   *   { access_token, refresh_token, refresh_expires_at, user }
   * See `phone-otp.dto.ts` for the full user projection.
   *
   * Status codes:
   *   200 — OTP matched and session issued.
   *   422 — code is malformed, expired, or wrong (`phone_otp.invalid_code`).
   *   401 — OTP matched but no Quart user exists for that phone
   *         (`phone_otp.unknown_user`); same response shape as wrong-code
   *         to avoid leaking which phone numbers are registered.
   *   429 — throttled (per-phone bucket; see `throttler.config.ts`).
   */
  @Post('verify')
  @ApiOkResponse({
    description:
      'OTP verified. Returns the session tokens + user profile (mirrors the email-login contract).',
    schema: {
      type: 'object',
      required: ['access_token', 'refresh_token', 'refresh_expires_at', 'user'],
      properties: {
        access_token: { type: 'string', description: 'Ed25519 JWT (1h TTL).' },
        refresh_token: { type: 'string', description: 'Ed25519 JWT (30d TTL).' },
        refresh_expires_at: { type: 'string', format: 'date-time' },
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
  ): Promise<VerifyOtpSessionResponse> {
    const { phoneNumber, code } = verifySchema.parse(body);
    const ctx = { ...extractVerifyContext(req), phoneNumber, code };
    return this.service.verifyAndIssueSession(ctx);
  }
}