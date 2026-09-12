import path from 'node:path';

import { createDb, SqlFileMigrationProvider } from '@quart/db';
import { CompiledQuery, type Kysely } from 'kysely';

const migrationsDir =
  process.env.QUART_MIGRATIONS_DIR ??
  // Dev: from apps/migrate/, walk up to repo root then into infrastructure/postgres/migrations
  path.resolve(process.cwd(), '..', '..', 'infrastructure', 'postgres', 'migrations');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const db = createDb({ connectionString: url });

const provider = new SqlFileMigrationProvider(migrationsDir);

// Kysely's built-in Migrator wraps every pending migration in a single
// transaction. That means a single broken migration (e.g. a CHECK constraint
// that doesn't match the data shape) rolls back ALL previously-applied
// migrations in the same run, and any later migration that could have fixed
// the constraint never gets a chance to run.
//
// For this repo we want later migrations to be able to fix earlier ones
// (see 0024 widening `permissions_code_check` to match 0021's namespaced
// codes). Run each migration in its own transaction instead, retrying any
// previously-failed migrations after the rest have had a chance to apply.

interface KyselyMigrationRow {
  name: string;
  timestamp: string;
}

// `db` is typed against the app schema, but this runner only talks to
// `kysely_migration` (managed by Kysely itself). Cast to `unknown` for the
// queries that touch it so we don't have to extend the DB type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

// Kysely's Migrator normally creates these tables itself inside the
// outer transaction. Replicate that here so a fresh DB doesn't blow up
// on the first `selectFrom('kysely_migration')`.
async function ensureMigrationTables(db: AnyDb): Promise<void> {
  await db.executeQuery(
    CompiledQuery.raw(`CREATE TABLE IF NOT EXISTS kysely_migration (
      name varchar(255) PRIMARY KEY,
      timestamp varchar(255) NOT NULL
    )`),
  );
  await db.executeQuery(
    CompiledQuery.raw(`CREATE TABLE IF NOT EXISTS kysely_migration_lock (
      id varchar(255) PRIMARY KEY,
      is_locked integer NOT NULL DEFAULT 0
    )`),
  );
  await db.executeQuery(
    CompiledQuery.raw(
      `INSERT INTO kysely_migration_lock (id, is_locked) VALUES ('migration_lock', 0) ON CONFLICT DO NOTHING`,
    ),
  );
}

async function getExecuted(db: AnyDb): Promise<Set<string>> {
  const rows: KyselyMigrationRow[] = await db
    .selectFrom('kysely_migration')
    .select(['name', 'timestamp'])
    .orderBy('name')
    .execute();
  return new Set(rows.map((r) => r.name));
}

const allMigrations = await provider.getMigrations();
const allNames = Object.keys(allMigrations).sort();

await ensureMigrationTables(db as AnyDb);

// `failures` is reset every pass: a migration that failed on an earlier
// pass may succeed on a later one once a later migration has unblocked it
// (e.g. 0024 widens the CHECK constraint that 0021's INSERT violates).
// `MAX_PASSES` bounds the loop so a migration that genuinely can't apply
// doesn't make us run forever.
const failures = new Map<string, string>();
const MAX_PASSES = 5;

for (let pass = 0; pass < MAX_PASSES; pass += 1) {
  const executed = await getExecuted(db as AnyDb);
  const pending = allNames.filter((n) => !executed.has(n));

  if (pending.length === 0) break;

  const beforeCount = executed.size;
  const beforeFailures = failures.size;

  for (const name of pending) {
    const migration = allMigrations[name];
    if (!migration) continue;
    try {
      await (db as AnyDb).transaction().execute(async (trx) => {
        // The provider's `up` function accepts a Kysely instance and runs
        // the migration SQL against it. Using `trx` keeps the migration's
        // statements in the same transaction as the kysely_migration insert.
        await migration.up(trx as unknown as AnyDb);
        await (trx as unknown as AnyDb)
          .insertInto('kysely_migration')
          .values({ name, timestamp: new Date().toISOString() })
          .execute();
      });
      process.stdout.write(`✓ ${name}\n`);
      failures.delete(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.set(name, message);
    }
  }

  const afterCount = (await getExecuted(db as AnyDb)).size;
  const appliedThisPass = afterCount - beforeCount;
  // Stop if we made no progress: either nothing was applied, or the only
  // new entries are migrations that we already knew were failing.
  if (appliedThisPass === 0 && failures.size >= beforeFailures) break;
}

const finalExecuted = await getExecuted(db as AnyDb);

// ponytail: a migration that fails on the first pass (e.g. 0021 hitting a
// CHECK constraint that 0024 widens) is inserted in `kysely_migration` only
// when it eventually succeeds — so rows end up in INSERT order, not name
// order. Kysely's Migrator validates name order at the start of every run,
// which would otherwise reject the table. Re-sort at the end.
if (finalExecuted.size > 1) {
  const sortedNames = [...finalExecuted].sort();
  await (db as AnyDb).transaction().execute(async (trx) => {
    await (trx as unknown as AnyDb)
      .executeQuery(
        CompiledQuery.raw('DELETE FROM kysely_migration'),
      );
    for (const name of sortedNames) {
      await (trx as unknown as AnyDb)
        .insertInto('kysely_migration')
        .values({ name, timestamp: new Date().toISOString() })
        .execute();
    }
  });
}

if (failures.size > 0) {
  process.stderr.write(`\n✗ ${failures.size} migration(s) failed:\n`);
  for (const [name, message] of failures) {
    process.stderr.write(`  ${name}: ${message}\n`);
  }
  await db.destroy();
  process.exit(1);
}

if (finalExecuted.size !== allNames.length) {
  const missing = allNames.filter((n) => !finalExecuted.has(n));
  process.stderr.write(
    `\n✗ ${missing.length} migration(s) not applied: ${missing.join(', ')}\n`,
  );
  await db.destroy();
  process.exit(1);
}

process.stdout.write(`\n✓ ${finalExecuted.size} migrations applied\n`);
await db.destroy();
