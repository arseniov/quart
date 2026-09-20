// apps/api/src/auth/login.controller.ts
// GH #33: POST /auth/login. Email + password sign-in for the mobile app
// (§3.6 — email+password is one of four identity options). Mirrors the
// phone-otp controller shape: `@Public` + `@SkipTenant` (no JWT, no
// cityId yet), `@Throttle` on the `login` bucket for per-email brute-force
// protection, and `@UsePipes(ZodValidationPipe)` so 422 lands with the
// canonical error envelope.
//
// Status codes:
//   200 — credentials accepted, session issued.
//   422 — body validation failed (missing/short email or password).
//   401 — credentials rejected (`auth.login_invalid_credentials`); same
//         shape as wrong-format to avoid leaking which emails are
//         registered.
//   429 — throttled (`login` bucket, per-email).
//
// This controller must be registered AFTER `AuthController` in
// AuthModule.controllers so the explicit `/auth/login` route takes
// precedence over the BA wildcard proxy (`/auth/*`). Both paths hit the
// same prefix — the wildcard is the fallback for everything else.

import { Body, Controller, HttpCode, Post, Req, UsePipes } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SkipTenant } from '../common/decorators/skip-tenant.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiGlobalResponses } from '../openapi/api-global-responses.decorator.js';

import { LoginRequestSchema, type LoginRequest, type LoginResponse } from './login.dto.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can
// emit `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { LoginService, extractLoginContext } from './login.service.js';
import { Public } from './public.decorator.js';

interface LoginFastifyRequest {
  id?: string | number;
  raw?: { id?: string | number };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

@Controller('auth/login')
@ApiTags('auth/login')
@ApiGlobalResponses()
@Public()
@SkipTenant()
export class LoginController {
  constructor(private readonly service: LoginService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ login: { limit: 10, ttl: 60_000 } })
  @ApiOkResponse({
    description:
      'Credentials accepted. Returns the session tokens + user profile (mirrors /auth/phone/verify and the email-login contract).',
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
  @ApiUnprocessableEntityResponse({ description: 'Email or password missing/too short.' })
  @ApiUnauthorizedResponse({ description: 'Credentials rejected (auth.login_invalid_credentials).' })
  @UsePipes(new ZodValidationPipe(LoginRequestSchema))
  async login(@Body() body: LoginRequest, @Req() req: LoginFastifyRequest): Promise<LoginResponse> {
    const ctx = { ...extractLoginContext(req), email: body.email, password: body.password };
    return this.service.signInAndIssueSession(ctx);
  }
}
