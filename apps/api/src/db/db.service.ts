import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createDb, type DB } from '@quart/db';
import type { Kysely, Transaction } from 'kysely';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

import { runInTenantTx, type TenantContext } from './run-in-tenant-tx.js';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly kysely: Kysely<DB>;
  readonly runInTenantTx: <T>(
    ctx: TenantContext,
    fn: (trx: Transaction<DB>) => Promise<T>,
  ) => Promise<T>;

  constructor(config: ConfigService) {
    this.kysely = createDb({ connectionString: config.env.DATABASE_URL });
    this.runInTenantTx = (ctx, fn) => runInTenantTx(this.kysely, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.kysely.destroy();
  }
}
