import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createDb } from '@quart/db';
import { Migrator, FileMigrationProvider } from 'kysely';

const migrationsDir =
  process.env.QUART_MIGRATIONS_DIR ??
  // Dev: from apps/migrate/, walk up to repo root then into infrastructure/postgres/migrations
  path.resolve(process.cwd(), '..', '..', 'infrastructure', 'postgres', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const db = createDb({ connectionString: url });

const provider = new FileMigrationProvider({ fs, path, migrationFolder: migrationsDir });
const migrator = new Migrator({ db, provider });

const result = await migrator.migrateToLatest();
const results = result.results ?? [];
if (result.error) {
  console.error(`✗ migration runner error: ${String(result.error)}`);
  process.exit(1);
}
const errors = results.filter((r) => r.status === 'Error');
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e.migrationName}: status=${e.status}`);
  process.exit(1);
}
console.log(`✓ ${results.length} migrations applied`);
await db.destroy();
