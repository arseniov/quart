import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { SkipTenant } from '../common/decorators/skip-tenant.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PasswordResetService } from './password-reset.service.js';
import { Public } from './public.decorator.js';

const ForgotSchema = z.object({ email: z.string().email() });
// ponytail: token min length 20 mirrors magic-link's VerifySchema. The
// real floor is the 68-hex we generate, so the lower bound here only
// rejects accidental truncation, not enumeration. newPassword min 12 is
// the same policy as the spec's Better Auth password schema.
const ResetSchema = z.object({
  token: z.string().min(20).max(128),
  newPassword: z.string().min(12).max(200),
});

type ForgotInput = z.infer<typeof ForgotSchema>;
type ResetInput = z.infer<typeof ResetSchema>;

/**
 * Forgot / reset password. Both endpoints are public (`@Public`) and skip
 * tenant scoping (`@SkipTenant`) — the caller has no cityId before they
 * reset, and the token is the only authorization needed.
 *
 * Forgot is throttled on both the `auth` bucket (IP) and `passwordreset`
 * (per-email) so attackers can't grind either dimension. Reset is IP-only:
 * it consumes the token, which is 256-bit CSPRNG, so token enumeration is
 * out of band.
 */
@Controller('auth/password')
@ApiGlobalResponses()
@ApiTags('auth/password')
@Public()
@SkipTenant()
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    auth: { limit: 10, ttl: 60_000 },
    passwordreset: { limit: 10, ttl: 60_000 },
  })
  @UsePipes(new ZodValidationPipe(ForgotSchema))
  async forgot(@Body() _body: ForgotInput): Promise<{ sent: true }> {
    // The controller always returns `{ sent: true }`. The service
    // returns early on unknown email without sending anything, so this
    // can't leak whether the address exists.
    await this.service.issue(_body.email);
    return { sent: true };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(ResetSchema))
  async reset(@Body() body: ResetInput): Promise<{ ok: boolean }> {
    const result = await this.service.reset(body.token, body.newPassword);
    // Spec: return `{ ok: false }` on every failure (no detail leak).
    if (!result.ok) return { ok: false };
    return { ok: true };
  }
}
