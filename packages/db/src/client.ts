import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { DB } from './types.js';

const { Pool } = pg;

export interface DbOptions {
  connectionString: string;
  rls?: boolean;
}

export function createDb(opts: DbOptions): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: opts.connectionString,
        max: 10,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
      }),
    }),
  });
}
