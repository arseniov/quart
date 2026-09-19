import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/public.decorator.js';
import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the controller constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { UsersService } from './users.service.js';

/**
 * Public user profile endpoint — exposed without authentication so the
 * mobile profile screen can deep-link from author bylines / mention
 * notifications. The endpoint carries no PII (see `users.dto.ts`); the
 * throttler guards against scraping.
 *
 * The route is rate-limited via the existing global `default` throttler
 * bucket at 60/min/IP — generous for normal navigation, enough to deter
 * bulk scraping. The per-route `@Throttle()` overrides the global bucket
 * limit without changing the bucket name.
 */
@Controller('users')
@Public()
@ApiGlobalResponses()
@ApiTags('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getById(@Param('id') id: string) {
    return this.svc.findPublicById(id);
  }
}
