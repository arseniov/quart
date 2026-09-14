import { Controller, Get, Param, Query } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ApiGlobalResponses } from "../openapi/api-global-responses.decorator.js";
const ListQuery = z.object({ country: z.string().length(2).optional() });

@Controller('cities')
@ApiGlobalResponses()
@ApiTags('cities')
@ApiBearerAuth('bearer')
export class CitiesController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>) {
    let q = this.db.kysely
      .selectFrom('cities')
      .select(['id', 'slug', 'name', 'country_code', 'locale_default', 'timezone', 'status'])
      .where('status', '=', 'active');
    if (query.country) q = q.where('country_code', '=', query.country);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      countryCode: r.country_code,
      localeDefault: r.locale_default,
      timezone: r.timezone,
      status: r.status,
    }));
  }

  @Get(':slug')
  async getBySlug(@Param('slug') slug: string) {
    const city = await this.db.kysely
      .selectFrom('cities')
      .select(['id', 'slug', 'name', 'country_code', 'locale_default', 'timezone', 'status'])
      .where('slug', '=', slug)
      .executeTakeFirstOrThrow();
    const neighborhoods = await this.db.kysely
      .selectFrom('neighborhoods')
      .select(['id', 'slug', 'name'])
      .where('city_id', '=', city.id)
      .execute();
    return {
      id: city.id,
      slug: city.slug,
      name: city.name,
      countryCode: city.country_code,
      localeDefault: city.locale_default,
      timezone: city.timezone,
      status: city.status,
      neighborhoods: neighborhoods.map((n) => ({ id: n.id, slug: n.slug, name: n.name })),
    };
  }

  @Get(':slug/neighborhoods')
  async neighborhoods(@Param('slug') slug: string) {
    const city = await this.db.kysely
      .selectFrom('cities')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirstOrThrow();
    const rows = await this.db.kysely
      .selectFrom('neighborhoods')
      .select(['id', 'slug', 'name'])
      .where('city_id', '=', city.id)
      .execute();
    return rows;
  }
}
