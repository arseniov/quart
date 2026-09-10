import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CompiledQuery } from 'kysely';
import type { Kysely, Migration, MigrationProvider } from 'kysely';

const MIGRATION_RE = /^(?<name>\d{4}_[a-z0-9_]+)\.(?<dir>up|down)\.sql$/i;

const noop = async () => undefined;

/**
 * MigrationProvider that reads `<name>.up.sql` / `<name>.down.sql` pairs from a
 * directory and exposes them as Kysely `Migration` objects. Kysely's built-in
 * `FileMigrationProvider` only loads `.js`/`.ts`/`.mjs`/`.mts` modules, which
 * doesn't match this project's plain-SQL convention.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationsDir: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await fs.readdir(this.migrationsDir);
    const out: Record<string, Migration> = {};

    for (const entry of entries) {
      const match = MIGRATION_RE.exec(entry);
      if (!match?.groups) continue;
      const { name, dir } = match.groups as { name: string; dir: 'up' | 'down' };
      const sql = await fs.readFile(path.join(this.migrationsDir, entry), 'utf8');

      const migration: Migration = out[name] ?? { up: noop, down: noop };
      const runner = async (db: Kysely<unknown>) => {
        await db.executeQuery(CompiledQuery.raw(sql));
      };
      if (dir === 'up') migration.up = runner;
      else migration.down = runner;
      out[name] = migration;
    }

    return out;
  }
}
