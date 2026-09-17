import { Body, Controller, HttpCode, HttpStatus, Post, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { SkipTenant } from '../common/decorators/skip-tenant.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the MagicLinkService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MagicLinkService } from './magic-link.service.js';
import { Public } from './public.decorator.js';

const RequestSchema = z.object({ email: z.string().email() });
const VerifySchema = z.object({ token: z.string().min(20).max(128) });

type RequestInput = z.infer<typeof RequestSchema>;
type VerifyInput = z.infer<typeof VerifySchema>;

/**
 * Magic-link sign-in. Both endpoints are public (`@Public`) and skip
 * tenant scoping (`@SkipTenant`): the user has no cityId before they
 * sign in, and verify does not touch any tenant-scoped table.
 *
 * Request is throttled by IP (auth bucket) AND per-email (magiclink
 * bucket). The per-email bucket enforces the "don't let an attacker
 * grind a single inbox" invariant that IP alone can't catch — see
 * throttler.config.ts.
 *
 * Limits are wired to `THROTTLE_MAGIC_LINK_LIMIT` /
 * `THROTTLE_TTL_SECONDS` at module-load time so ops can tune them via
 * env without redeploying code. The throttle bucket default lives in
 * throttler-env.ts (currently 5/min); the per-route override here is
 * the spec-required 10/min.
 */
const MAGIC_LINK_LIMIT = (() => {
  const raw = process.env['THROTTLE_MAGIC_LINK_LIMIT'];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();
const MAGIC_LINK_TTL_MS = (() => {
  const raw = process.env['THROTTLE_TTL_SECONDS'];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) * 1000 : 60_000;
})();

@Controller('auth/magic-link')
@ApiGlobalResponses()
@ApiTags('auth/magic-link')
@Public()
@SkipTenant()
export class MagicLinkController {
  constructor(private readonly service: MagicLinkService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    // IP-keyed — `auth` bucket uses the standard ip/user tracker.
    auth: { limit: 10, ttl: 60_000 },
    // Per-email — `magiclink` bucket reads req.body.email.
    magiclink: { limit: MAGIC_LINK_LIMIT, ttl: MAGIC_LINK_TTL_MS },
  })
  @UsePipes(new ZodValidationPipe(RequestSchema))
  async request(@Body() _body: RequestInput): Promise<{ sent: true }> {
    await this.service.issue(_body.email);
    return { sent: true };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(VerifySchema))
  async verify(@Body() body: VerifyInput): Promise<{ ok: boolean; email?: string }> {
    const result = await this.service.consume(body.token);
    // Spec: return `{ ok: false }` on every failure (no detail leak).
    if (!result) return { ok: false };
    return { ok: true, email: result.email };
  }
}

// Re-export the input types for downstream readers.
export type { RequestInput, VerifyInput };

// Re-exported for tests so they can assert the env-derived values
// match the decorator without re-reading process.env.
export const __testing__ = {
  MAGIC_LINK_LIMIT,
  MAGIC_LINK_TTL_MS,
};
