/**
 * Cross-city RLS isolation — security gate.
 *
 * Spins up a real PostGIS Postgres via testcontainers, applies the 0001-0014
 * migrations (the RLS-critical subset), seeds two cities with one issue each,
 * and proves that:
 *   - a tenant scope with city_id=A cannot see city B's rows
 *   - a tenant scope with city_id=B cannot see city A's rows
 *
 * This test is excluded from `pnpm test` (unit-only) via vitest.config.ts.
 * Run with: `pnpm --filter @quart/api run test:integration`. Requires Docker.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '@quart/db';
import type { TenantContext } from '@quart/shared-types';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { FileMigrationProvider, Migrator, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runInTenantTx } from '../../src/db/run-in-tenant-tx.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../infrastructure/postgres/migrations', import.meta.url),
);

let container: StartedPostgreSqlContainer | undefined;
let connectionUri: string;
let cityAId = '';
let cityBId = '';

const dbOptions = () => ({ connectionString: connectionUri });

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('quart')
      .withUsername('quart')
      .withPassword('quart')
      .start();
    connectionUri = container.getConnectionUri();
    process.env.TEST_DATABASE_URL = connectionUri;
  } else {
    connectionUri = process.env.TEST_DATABASE_URL;
  }

  // The migrations expect postgis/pgcrypto/citext/uuid-ossp/pg_trgm already
  // enabled (the prod init container does this). Enable them here so the
  // testcontainer can stand alone.
  const bootstrap = createDb({ connectionString: connectionUri });
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(bootstrap);
  await bootstrap.destroy();

  // Apply the RLS-critical migrations 0001-0014 via Kysely's Migrator.
  const db = createDb({ connectionString: connectionUri });
  const provider = new FileMigrationProvider({
    fs,
    path,
    migrationFolder: MIGRATIONS_DIR,
  });
  const migrator = new Migrator({ db, provider });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  for (const r of result.results ?? []) {
    if (r.status === 'Error') throw new Error(`migration failed: ${r.migrationName}`);
  }

  // Seed two cities. The bootstrap connection owns the tables and is a
  // superuser, so RLS doesn't apply to seeding.
  const seed = createDb({ connectionString: connectionUri });
  await sql`INSERT INTO countries (id, code, name) VALUES (gen_random_uuid(), 'IT', 'Italia')`.execute(
    seed,
  );
  // Allow the quart_app role to be assumed by anyone GRANTed.
  await sql`GRANT quart_app TO quart`.execute(seed);

  const cityA = await sql`
    INSERT INTO cities (slug, country_code, name, locale_default, timezone, status)
    VALUES (${'rls-roma-' + Date.now()}, 'IT', 'Roma', 'it', 'Europe/Rome', 'active')
    RETURNING id
  `.execute(seed);
  const cityB = await sql`
    INSERT INTO cities (slug, country_code, name, locale_default, timezone, status)
    VALUES (${'rls-milano-' + Date.now()}, 'IT', 'Milano', 'it', 'Europe/Rome', 'active')
    RETURNING id
  `.execute(seed);
  cityAId = cityA.rows[0]!.id as string;
  cityBId = cityB.rows[0]!.id as string;

  // Minimal fixtures per city: one user, one neighborhood, one issue.
  // Issues require neighborhood + author_user_id (NOT NULL FKs).
  async function seedIssue(cityId: string, label: string): Promise<string> {
    const userRes = await sql`
      INSERT INTO users (handle, display_name, default_city_id)
      VALUES (${`rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}, ${label}, ${cityId})
      RETURNING id
    `.execute(seed);
    const userId = userRes.rows[0]!.id as string;
    const neighRes = await sql`
      INSERT INTO neighborhoods (city_id, slug, name)
      VALUES (${cityId}, ${`rls-${label}-${Date.now()}`}, ${label})
      RETURNING id
    `.execute(seed);
    const neighId = neighRes.rows[0]!.id as string;
    const issueRes = await sql`
      INSERT INTO issues (city_id, neighborhood_id, author_user_id, title, description, location)
      VALUES (
        ${cityId},
        ${neighId},
        ${userId},
        ${`Issue in ${label}`},
        ${'seeded for RLS test'},
        ST_GeogFromText('SRID=4326;POINT(12.5 41.9)')
      )
      RETURNING id
    `.execute(seed);
    return issueRes.rows[0]!.id as string;
  }
  await seedIssue(cityAId, 'A');
  await seedIssue(cityBId, 'B');
  await seed.destroy();
}, 120_000);

afterAll(async () => {
  if (container) await container.stop();
});

describe('RLS isolation via runInTenantTx', () => {
  const ctx = (cityId: string, isSuperAdmin: boolean): TenantContext => ({
    cityId,
    userId: '00000000-0000-0000-0000-000000000000',
    isSuperAdmin,
    requestId: 'rls-isolation-test',
  });

  it('city A scope reads only city A issues', async () => {
    const db = createDb(dbOptions());
    const rows = await runInTenantTx(db, ctx(cityAId, false), async (trx) =>
      trx.selectFrom('issues').selectAll().execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.city_id === cityAId)).toBe(true);
    await db.destroy();
  });

  it('city B scope reads only city B issues', async () => {
    const db = createDb(dbOptions());
    const rows = await runInTenantTx(db, ctx(cityBId, false), async (trx) =>
      trx.selectFrom('issues').selectAll().execute(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.city_id === cityBId)).toBe(true);
    await db.destroy();
  });

  it('is_super_admin=true reads across cities (0015 bypass)', async () => {
    const db = createDb(dbOptions());
    const rows = await runInTenantTx(
      db,
      { cityId: cityAId, userId: '00000000-0000-0000-0000-000000000000', isSuperAdmin: true, requestId: 'rls-isolation-test' },
      async (trx) => trx.selectFrom('issues').selectAll().execute(),
    );
    const cityIds = new Set(rows.map((r) => r.city_id));
    expect(cityIds.has(cityAId)).toBe(true);
    expect(cityIds.has(cityBId)).toBe(true);
    await db.destroy();
  });
});
