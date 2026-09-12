import { fileURLToPath } from 'node:url';

import { createDb, SqlFileMigrationProvider } from '@quart/db';
import { Migrator, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { kyselyAdapter } from '../../src/auth/auth.adapter.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../infrastructure/postgres/migrations', import.meta.url),
);

let connectionUri: string;

describe('AuthService Kysely adapter — operator coverage (integration)', () => {
  beforeAll(async () => {
    connectionUri = process.env.TEST_DATABASE_URL ?? '';
    if (!connectionUri) throw new Error('TEST_DATABASE_URL not set');

    const bootstrap = createDb({ connectionString: connectionUri });
    await sql`SELECT 1`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(bootstrap);

    const migrator = new Migrator({
      db: bootstrap,
      provider: new SqlFileMigrationProvider(MIGRATIONS_DIR),
    });
    await migrator.migrateToLatest();
    await bootstrap.destroy();
  }, 180_000);

  // ponytail: covers BA's `eq` operator end-to-end via the adapter factory.
  it('eq: sign-up + lookup by email', async () => {
    const db = createDb({ connectionString: connectionUri });
    const adapter = kyselyAdapter(db);

    const email = `eq-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const api = adapter();
    await api.create({
      model: 'user',
      data: { email, name: 'Eq', emailVerified: false },
    });

    const row = await api.findOne<{ id: string; email: string }>({
      model: 'user',
      where: [{ field: 'email', value: email }],
    });
    expect(row).not.toBeNull();
    expect(row?.email).toBe(email);

    await db.destroy();
  });

  // ponytail: covers BA's `in` operator (used by account lookups).
  it('in: lookup by id IN (...)', async () => {
    const db = createDb({ connectionString: connectionUri });
    const adapter = kyselyAdapter(db);

    const emailA = `in-a-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const emailB = `in-b-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const api = adapter();
    const a = (await api.create({
      model: 'user',
      data: { email: emailA, name: 'InA', emailVerified: false },
    })) as { id: string };
    const b = (await api.create({
      model: 'user',
      data: { email: emailB, name: 'InB', emailVerified: false },
    })) as { id: string };

    const rows = await api.findMany<{ id: string; email: string }>({
      model: 'user',
      where: [{ field: 'id', value: [a.id, b.id], operator: 'in' }],
    });
    expect(rows).toHaveLength(2);
    const emails = rows.map((r) => r.email).sort();
    expect(emails).toEqual([emailA, emailB].sort());

    await db.destroy();
  });

  // ponytail: covers BA's OR connector (used by account lookups when both
  // providerId AND userId are passed).
  it('OR connector: lookup with two clauses joined by OR', async () => {
    const db = createDb({ connectionString: connectionUri });
    const adapter = kyselyAdapter(db);

    const emailX = `or-x-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const emailY = `or-y-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const api = adapter();
    await api.create({
      model: 'user',
      data: { email: emailX, name: 'OrX', emailVerified: false },
    });
    await api.create({
      model: 'user',
      data: { email: emailY, name: 'OrY', emailVerified: false },
    });

    const rows = await api.findMany<{ email: string }>({
      model: 'user',
      where: [
        { field: 'email', value: emailX },
        { field: 'email', value: emailY, connector: 'OR' },
      ],
    });
    const emails = rows.map((r) => r.email).filter((e) => e === emailX || e === emailY);
    expect(emails.sort()).toEqual([emailX, emailY].sort());

    await db.destroy();
  });
});