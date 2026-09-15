import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from './public.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the MagicLinkService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MagicLinkService } from './magic-link.service.js';

const RequestBody = z.object({ email: z.string().email() });
const VerifyBody = z.object({ token: z.string().min(20).max(128) });

type RequestInput = z.infer<typeof RequestBody>;
type VerifyInput = z.infer<typeof VerifyBody>;

/**
 * Magic-link sign-in. Both endpoints are public (`@Public`) and skip
 * tenant scoping (`@SkipTenant` via `Public` — see auth.module.ts):
 * the user has no cityId before they sign in, and verify does not
 * touch any tenant-scoped table.
 *
 * Request is throttled by IP (auth bucket, 10/min) AND per-email
 * (magiclink bucket, 10/min). The per-email bucket enforces the
 * "don't let an attacker grind a single inbox" invariant that IP alone
 * can't catch — see throttler.config.ts.
 */
@Controller('auth/magic-link')
@ApiTags('auth/magic-link')
@Public()
export class MagicLinkController {
  constructor(private readonly service: MagicLinkService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    // IP-keyed — `auth` bucket uses the standard ip/user tracker.
    auth: { limit: 10, ttl: 60_000 },
    // Per-email — `magiclink` bucket reads req.body.email.
    magiclink: { limit: 10, ttl: 60_000 },
  })
  async request(@Body() body: unknown): Promise<{ sent: true }> {
    const { email } = RequestBody.parse(body);
    await this.service.issue(email);
    return { sent: true };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: unknown): Promise<{ ok: boolean; email?: string }> {
    const { token } = VerifyBody.parse(body);
    const result = await this.service.consume(token);
    // Spec: return `{ ok: false }` on every failure (no detail leak).
    if (!result) return { ok: false };
    return { ok: true, email: result.email };
  }
}

// Re-export the input types for downstream readers.
export type { RequestInput, VerifyInput };
