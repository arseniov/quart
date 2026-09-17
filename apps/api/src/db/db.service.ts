import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createDb, type DB } from '@quart/db';
import type { Kysely, Transaction } from 'kysely';
import type { Logger as PinoLogger } from 'pino';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
import { SLOW_QUERY_LOGGER } from '../logger/logger.module.js';
import { SlowQueryEnvSchema, SlowQueryPlugin } from '../logger/slow-query.js';

import { runInTenantTx, type TenantContext } from './run-in-tenant-tx.js';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly kysely: Kysely<DB>;
  readonly runInTenantTx: <T>(
    ctx: TenantContext,
    fn: (trx: Transaction<DB>) => Promise<T>,
  ) => Promise<T>;

  constructor(
    config: ConfigService,
    @Inject(SLOW_QUERY_LOGGER) slowQueryLogger: PinoLogger,
  ) {
    // Narrow env schema — T42 deviation. We deliberately don't pull in the
    // full app EnvSchema here so the DB module stays importable from
    // workers / scripts that don't have Sentry / OTel surface.
    const slowQueryEnv = SlowQueryEnvSchema.parse(process.env);
    this.kysely = createDb({ connectionString: config.env.DATABASE_URL }).withPlugin(
      new SlowQueryPlugin({ env: slowQueryEnv, logger: slowQueryLogger }),
    );
    this.runInTenantTx = (ctx, fn) => runInTenantTx(this.kysely, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.kysely.destroy();
  }
}
