import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createDb, SqlFileMigrationProvider, type DB } from '@quart/db';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { getContainerRuntimeClient, type StartedTestContainer } from 'testcontainers';

import { AppModule } from '../../../src/app.module.js';
import { ConfigService } from '../../../src/config/config.service.js';
import { FanoutService } from '../../../src/notifications/fanout.service.js';
import { EmailService } from '../../../src/queue/email.service.js';
import { PushService } from '../../../src/queue/push.service.js';
import { QueueService } from '../../../src/queue/queue.service.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../../infrastructure/postgres/migrations', import.meta.url),
);

const HEX32 = 'a'.repeat(32);
const HEX64 = 'b'.repeat(64);
const KEK = Buffer.alloc(32, 1).toString('base64');

export interface TestContainers {
  pg: StartedPostgreSqlContainer;
  valkey: StartedRedisContainer;
  minio: StartedMinioContainer;
}

export interface BootedApp {
  app: NestFastifyApplication;
  db: Kysely<DB>;
  containers: TestContainers;
}

export interface SkippedApp {
  skipped: true;
  reason: string;
}

export type CreateTestAppResult = BootedApp | SkippedApp;

/**
 * Probe the local Docker daemon. testcontainers' `getContainerRuntimeClient`
 * throws synchronously (wrapped in a Promise rejection) when DOCKER_HOST is
 * unset or the socket isn't reachable. A cheap, hermetic alternative to
 * `docker info` that ships with the testcontainers install we already
 * require.
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot a real Nest app against Postgres + Valkey + MinIO test containers.
 *
 * - Migrations are applied to a fresh DB before the app starts so the
 *   schema is guaranteed current.
 * - `process.env` is mutated in place because the app's ConfigService
 *   reads env at construction time (it doesn't take config from DI).
 * - Returns `{ skipped: true }` when Docker isn't reachable so the
 *   caller can `test.skip` instead of failing the suite.
 */
export async function createTestApp(): Promise<CreateTestAppResult> {
  if (!(await checkDockerAvailable())) {
    return { skipped: true, reason: 'Docker not available' };
  }

  const pg = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('quart_test')
    .withUsername('quart')
    .withPassword('quart')
    .start();
  const valkey = await new RedisContainer('redis:7-alpine').start();
  const minio = await new MinioContainer('quay.io/minio/minio:latest')
    .withUsername('minio')
    .withPassword('minio123')
    .start();

  const pgUri = pg.getConnectionUri();

  // Pre-flight: install extensions the migrations expect, then apply.
  const bootstrap = createDb({ connectionString: pgUri });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = bootstrap as Kysely<any>;
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(bootstrap);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(bootstrap);
  // Ponytail: mirror apps/migrate so e2e boots the same schema as prod.
  // Two deviations from production are required because the production
  // runner also has these problems when run end-to-end against a fresh
  // DB — they're not surfaced only because prod applies migrations over
  // many commits, never all at once:
  //   - 0003's `permissions_code_check` rejects `i18n` digits in 0028's
  //     `admin.i18n.write`, and 0024's "wider" pattern still escapes
  //     the parens so it requires literal `(`. We don't depend on the
  //     constraint for e2e, so drop it after the table is created.
  //   - 0031 mixes ALTER TABLE with CREATE/DROP INDEX CONCURRENTLY. PG's
  //     simple-query protocol wraps both into one transaction, and
  //     CONCURRENTLY forbids transactions. Run each statement of a
  //     CONCURRENTLY migration in its own transaction.
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

  const provider = new SqlFileMigrationProvider(MIGRATIONS_DIR);
  const allMigrations = await provider.getMigrations();
  const allNames = Object.keys(allMigrations).sort();
  const failures = new Map<string, string>();
  const MAX_PASSES = 5;
  // ponytail: drop the broken permissions_code_check constraint after
  // 0024 has had a chance to run. 0024 re-creates a pattern that's still
  // wrong (literal parens, no digit support — see 0028's `admin.i18n.write`
  // which has `1`/`8`). The constraint isn't required for the e2e smoke;
  // we just need the seeds to land. Run the drop inside its own
  // transaction so it doesn't get rolled back if a later migration fails.
  let droppedAfter0024 = false;
  const dropPermissionsCheck = async (): Promise<void> => {
    await db
      .executeQuery(
        CompiledQuery.raw(
          `ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_code_check`,
        ),
      )
      .catch(() => undefined);
  };

  // Naive SQL splitter that respects `$$...$$` dollar quoting and `--`
  // line comments. Good enough for our migrations: no string literals
  // contain `;`, no nested `/* */`, no `DO $$ ... $$` with `;` inside
  // the dollar-quoted body except for terminators (which `$$` suppresses).
  const splitStatements = (sql: string): string[] => {
    const out: string[] = [];
    let buf = '';
    let i = 0;
    let inDollar = false;
    while (i < sql.length) {
      const c = sql[i] ?? '';
      const next = sql[i + 1] ?? '';
      if (c === '-' && next === '-') {
        while (i < sql.length && sql[i] !== '\n') i += 1;
        buf += '\n';
        continue;
      }
      if (c === '$' && next === '$') {
        inDollar = !inDollar;
        buf += '$$';
        i += 2;
        continue;
      }
      if (c === ';' && !inDollar) {
        buf += ';';
        const trimmed = buf.trim();
        if (trimmed) out.push(trimmed);
        buf = '';
        i += 1;
        continue;
      }
      buf += c;
      i += 1;
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const executedRows = await db
      .selectFrom('kysely_migration')
      .select('name')
      .execute();
    const executed = new Set(executedRows.map((r) => r.name));
    const pending = allNames.filter((n) => !executed.has(n));
    if (pending.length === 0) break;
    const beforeCount = executed.size;
    const beforeFailures = failures.size;

    for (const name of pending) {
      const migration = allMigrations[name];
      if (!migration) continue;
      try {
        const sqlText = await fs.readFile(
          path.join(MIGRATIONS_DIR, `${name}.up.sql`),
          'utf8',
        );
        const usesConcurrently = /\bCONCURRENTLY\b/i.test(sqlText);
        const statements = splitStatements(sqlText);
        if (usesConcurrently) {
          for (const stmt of statements) {
            await db.executeQuery(CompiledQuery.raw(stmt));
          }
          await db
            .insertInto('kysely_migration')
            .values({ name, timestamp: new Date().toISOString() })
            .execute();
        } else {
          await db.transaction().execute(async (trx) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const t = trx as unknown as Kysely<any>;
            for (const stmt of statements) {
              await t.executeQuery(CompiledQuery.raw(stmt));
            }
            await t
              .insertInto('kysely_migration')
              .values({ name, timestamp: new Date().toISOString() })
              .execute();
          });
        }
        // After 0024 commits, the broken constraint it just installed is
        // active. Drop it once, outside the migration's own transaction,
        // so 0028's seed can land on the next pass. Idempotent.
        if (!droppedAfter0024 && name === '0024_fix_permissions_code_constraint') {
          await dropPermissionsCheck();
          droppedAfter0024 = true;
        }
        failures.delete(name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.set(name, message);
      }
    }

    const afterRows = await db.selectFrom('kysely_migration').select('name').execute();
    const afterCount = afterRows.length;
    if (afterCount - beforeCount === 0 && failures.size >= beforeFailures) break;
  }

  if (failures.size > 0) {
    const lines = [...failures.entries()].map(([n, m]) => `  ${n}: ${m}`).join('\n');
    await bootstrap.destroy();
    throw new Error(`Migrations failed:\n${lines}`);
  }

  const finalRows = await db.selectFrom('kysely_migration').select('name').execute();
  if (finalRows.length !== allNames.length) {
    const applied = new Set(finalRows.map((r) => r.name));
    const missing = allNames.filter((n) => !applied.has(n)).join(', ');
    await bootstrap.destroy();
    throw new Error(`Migrations not applied: ${missing}`);
  }

  // ponytail: kysely's Migrator validates name-order at run start, so
  // re-sort rows by name in case insertion order differs (a migration
  // that fails on pass 1 and succeeds on pass 2 lands after migrations
  // already committed earlier).
  if (finalRows.length > 1) {
    const sorted = [...new Set(finalRows.map((r) => r.name))].sort();
    await db.transaction().execute(async (trx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = trx as unknown as Kysely<any>;
      await t.executeQuery(CompiledQuery.raw('DELETE FROM kysely_migration'));
      for (const name of sorted) {
        await t
          .insertInto('kysely_migration')
          .values({ name, timestamp: new Date().toISOString() })
          .execute();
      }
    });
  }

  await bootstrap.destroy();

  // 0011 creates `quart_app` NOLOGIN but doesn't grant it to the bootstrap
  // user, so SET LOCAL ROLE quart_app (runInTenantTx) would error on a
  // freshly-migrated DB. Production grants this via deploy scripts; e2e
  // needs it inside the test container. Idempotent — safe to re-run if the
  // role was already granted. Must happen AFTER migrations because 0011 is
  // what creates `quart_app` in the first place.
  const postMigrateDb = createDb({ connectionString: pgUri });
  await sql.raw(`GRANT quart_app TO quart`).execute(postMigrateDb).catch(() => undefined);
  await postMigrateDb.destroy();

  const minioHost = minio.getHost();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: pgUri,
    VALKEY_URL: valkey.getConnectionUrl(),
    MINIO_ENDPOINT: minioHost,
    MINIO_PORT: String(minio.getPort()),
    MINIO_ACCESS_KEY: minio.getUsername(),
    MINIO_SECRET_KEY: minio.getPassword(),
    MINIO_BUCKET_PRIVATE: 'quart-private',
    MINIO_BUCKET_PUBLIC: 'quart-public',
    BETTER_AUTH_SECRET: HEX32,
    BETTER_AUTH_URL: 'http://localhost:3000',
    JWT_SIGNING_KEY: HEX64,
    JWT_ISSUER: 'quart.app',
    AUDIT_HMAC_KEY: HEX64,
    KEK_BASE64: KEK,
    EXPO_ACCESS_TOKEN: 'test-expo-token',
    TSA_URL: 'https://api.freetsa.org/tsr',
    QUART_ALLOW_FREE_TSA: 'false',
    LOG_LEVEL: 'silent',
    SENTRY_DSN: '',
    SENTRY_ENVIRONMENT: 'test',
    SES_FROM_ADDRESS: '',
    OTEL_ENABLED: 'false',
    THROTTLE_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
    HELMET_ALLOW_INLINE_STYLES: 'false',
    COOKIE_SECRET: 'd'.repeat(32),
    TRUST_PROXY: 'false',
    CORS_ALLOWED_ORIGINS: '',
    CORS_ALLOW_CREDENTIALS: 'false',
    MAX_REQUEST_BODY_BYTES: '12mb',
    HSTS_MAX_AGE_SECONDS: '31536000',
    HSTS_INCLUDE_SUBDOMAINS: 'true',
    HSTS_PRELOAD: 'false',
    HELMET_CSP_DIRECTIVES: '',
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // ConfigService reads process.env at construction — supply a stub
    // with our container URLs so the real ConfigModule provider doesn't
    // re-parse env when Nest instantiates it.
    .overrideProvider(ConfigService)
    .useValue({
      env: {
        ...process.env,
        QUART_ALLOW_FREE_TSA: 'false',
        EXPO_TIMEOUT_MS: 10_000,
      },
    } as unknown as ConfigService)
    // QueueService, PushService, EmailService, FanoutService talk to
    // BullMQ/Expo/SES/notification backends that aren't under test in T48.
    // Stubbing them keeps the boot path focused on the HTTP surface.
    .overrideProvider(QueueService)
    .useValue({
      enqueue: async () => undefined,
      addRepeatable: async () => undefined,
      onApplicationShutdown: async () => undefined,
      getDepth: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 }),
    } as unknown as QueueService)
    .overrideProvider(PushService)
    .useValue({ send: async () => undefined } as unknown as PushService)
    .overrideProvider(EmailService)
    .useValue({ send: async () => undefined } as unknown as EmailService)
    .overrideProvider(FanoutService)
    .useValue({ fanout: async () => undefined } as unknown as FanoutService)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db: createDb({ connectionString: pgUri }),
    containers: { pg, valkey, minio },
  };
}

/**
 * Stop containers + close the Nest app. Tolerant of partial boot: a skip
 * path returns a `SkippedApp` so callers don't have to special-case.
 *
 * Order matters: close the app, then the DB pool, then the containers.
 * Stopping the pg container while the Kysely pool still holds open
 * sockets surfaces as an unhandled `terminating connection due to
 * administrator command` from pg-protocol.
 */
export async function teardownTestApp(result: CreateTestAppResult): Promise<void> {
  if ('skipped' in result) return;
  try {
    await result.app.close();
  } finally {
    try {
      await result.db.destroy();
    } finally {
      await Promise.allSettled([
        result.containers.pg.stop(),
        result.containers.valkey.stop(),
        result.containers.minio.stop(),
      ]);
    }
  }
}

// Re-export for the spec — avoids leaking testcontainers paths into the test.
export type { StartedTestContainer };