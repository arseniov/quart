import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Kysely, Migrator, PostgresDialect, FileMigrationProvider } from 'kysely';
import pkg from 'pg';

import type { DB } from './types.js';

const { Pool } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 1 }) }),
  });

  const provider = new FileMigrationProvider({
    fs,
    path,
    migrationFolder: migrationsDir,
  });

  const migrator = new Migrator({ db, provider });

  const command = process.argv[2] ?? 'up';
  const result =
    command === 'down'
      ? await migrator.migrateDown()
      : command === 'latest'
        ? await migrator.migrateToLatest()
        : await migrator.migrateUp();

  const results = result.results ?? [];
  const errors = results.filter((r) => r.status === 'Error');
  if (errors.length || result.error) {
    for (const e of errors) console.error(`✗ ${e.migrationName}`);
    if (result.error) console.error(result.error);
    process.exit(1);
  }
  console.log(`✓ ${results.length} migrations applied (${command})`);
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
