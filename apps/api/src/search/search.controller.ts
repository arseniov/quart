import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MfaGuard } from '../auth/mfa.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermission } from '../rbac/permissions.decorator.js';
import { RbacGuard } from '../rbac/rbac.guard.js';

import { SearchQuery } from './search.dto.js';
import type { SearchHit } from './search.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the SearchService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchService } from './search.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
@Controller('search')
@ApiGlobalResponses()
@ApiTags('search')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, MfaGuard, RbacGuard)
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  @Get()
  @RequirePermission('content.read')
  async search(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(SearchQuery)) q: SearchQuery,
  ): Promise<SearchHit[]> {
    return this.svc.search(user, q);
  }
}
