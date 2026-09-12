import { fileURLToPath } from 'node:url';

import { createDb, SqlFileMigrationProvider } from '@quart/db';
import { Migrator, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../../src/auth/auth.service.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../infrastructure/postgres/migrations', import.meta.url),
);

let connectionUri: string;

describe('AuthService Kysely adapter (integration)', () => {
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

  it('signs up, persists the user, and re-reads via the adapter', async () => {
    const email = `x-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;
    const svc = new AuthService(
      {
        env: {
          BETTER_AUTH_SECRET: 'a'.repeat(32),
          BETTER_AUTH_URL: 'http://localhost:3000',
          DATABASE_URL: connectionUri,
        },
      } as never,
      // ponytail: kysely isn't used in the sign-up flow's adapter (BA builds
      // its own internal calls) — passing a fresh handle keeps DI happy.
      { kysely: createDb({ connectionString: connectionUri }) } as never,
    );

    const result = await svc.instance.api.signUpEmail({
      body: { email, password: 'password123', name: 'X' },
    });
    expect(result).toBeDefined();

    const db = createDb({ connectionString: connectionUri });
    const row = await db
      .selectFrom('user' as never)
      .selectAll()
      .where('email' as never, '=', email as never)
      .executeTakeFirst();
    expect(row).toBeDefined();
    expect((row as { email: string }).email).toBe(email);
    await db.destroy();
  });
});
