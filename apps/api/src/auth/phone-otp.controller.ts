import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthService } from './auth.service.js';

const phoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+\d{10,15}$/, 'E.164 phone format required'),
});
const verifySchema = phoneSchema.extend({
  code: z.string().regex(/^\d{6}$/, '6-digit code required'),
});

/**
 * Proxies phone OTP request/verify to Better Auth's `phoneNumber` plugin.
 *
 * BA handles rate-limiting, retries, and session issuance; we just validate
 * the shape at the trust boundary and forward. Endpoints are mounted under
 * `/auth/phone/*` so the existing `AuthController`'s wildcard at `/auth/*`
 * is bypassed (NestJS picks the more specific route).
 *
 * NB: BA's phone plugin adds these endpoints at runtime; they're not part
 * of the static `InferAPI` type, so we cast through `unknown` to a
 * structural type that matches the plugin's documented contract.
 */
@Controller('auth/phone')
export class PhoneOtpController {
  private readonly api: {
    sendPhoneNumberOTP: (args: { body: { phoneNumber: string } }) => Promise<unknown>;
    verifyPhoneNumber: (args: {
      body: { phoneNumber: string; code: string };
    }) => Promise<unknown>;
  };

  constructor(auth: AuthService) {
    this.api = (auth.instance.api as unknown) as PhoneOtpController['api'];
  }

  @Post('request')
  async requestOtp(@Body() body: unknown) {
    const { phoneNumber } = phoneSchema.parse(body);
    return this.api.sendPhoneNumberOTP({ body: { phoneNumber } });
  }

  @Post('verify')
  async verifyOtp(@Body() body: unknown) {
    const { phoneNumber, code } = verifySchema.parse(body);
    return this.api.verifyPhoneNumber({ body: { phoneNumber, code } });
  }
}