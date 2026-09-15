import { Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';

import { cookieClearOptions } from './cookie-helpers.js';
import type { AuthUser } from './decorators/current-user.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SignOutService } from './sign-out.service.js';

/**
 * POST /auth/sign-out — revoke the caller's session and clear the
 * mobile session cookie. The `__Host-quart-api-session` Set-Cookie
 * carries Secure + Path=/ + SameSite=Lax + maxAge=0 so the browser
 * drops it on response.
 *
 * The route is mounted at `auth/sign-out`; `auth.controller.ts`'s
 * `@All('*')` is registered first, but NestJS resolves routes by
 * path specificity, so the explicit `@Post('sign-out')` here takes
 * priority over the Better Auth wildcard. (Defensive note: if a future
 * change registers another wildcard under `auth`, double-check
 * routing with an integration test before relying on specificity.)
 *
 * No request body. The session id comes from `req.user.sessionId`,
 * which JwtAuthGuard copies from `claims.jti` (the JWT's UUID). The
 * service does the DB revoke + audit write in a single transaction
 * so a successful revoke always has a matching chain entry.
 *
 * `req.id` (set by RequestIdMiddleware) is forwarded to the service
 * so the `auth.sign_out` audit row carries the same `request_id` as
 * the HTTP response headers and the rest of the chain.
 */
@Controller('auth/sign-out')
@ApiGlobalResponses()
@ApiTags('auth')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
export class SignOutController {
  constructor(private readonly service: SignOutService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  async signOut(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    await this.service.signOut(user, req.id);
    res.clearCookie('__Host-quart-api-session', cookieClearOptions('mobile'));
  }
}
