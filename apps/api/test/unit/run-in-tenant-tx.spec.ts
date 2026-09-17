import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
} from 'kysely';
import { describe, it, expect } from 'vitest';

import { runInTenantTx } from '../../src/db/run-in-tenant-tx.js';

/**
 * Minimal Driver that routes every executed SQL string into `calls`.
 * `beginTransaction` / `commitTransaction` / `rollbackTransaction` follow the
 * real PostgresDriver's pattern of emitting the SQL via the connection's
 * `executeQuery`, so they show up in the same capture list.
 */
class CaptureDriver implements Driver {
  readonly calls: string[] = [];

  init(): Promise<void> {
    return Promise.resolve();
  }

  acquireConnection(): Promise<DatabaseConnection> {
    const conn: DatabaseConnection = {
      executeQuery: <R>(compiledQuery: CompiledQuery) => {
        this.calls.push(compiledQuery.sql);
        return Promise.resolve({ rows: [] as R[] });
      },
      streamQuery: <R>() =>
        (async function* () {
          // noop
        })() as AsyncIterableIterator<{ rows: R[] }>,
    };
    return Promise.resolve(conn);
  }

  beginTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw('begin')).then(() => undefined);
  }

  commitTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw('commit')).then(() => undefined);
  }

  rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    return conn.executeQuery(CompiledQuery.raw('rollback')).then(() => undefined);
  }

  releaseConnection(): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

function makeDb(driver: CaptureDriver): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

describe('runInTenantTx', () => {
  it('begins, sets locals, runs fn, commits', async () => {
    const driver = new CaptureDriver();
    const db = makeDb(driver);

    await runInTenantTx(
      db,
      {
        cityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        isSuperAdmin: false,
        requestId: 'cccc-cccc',
      },
      async () => {
        /* noop */
      },
    );

    expect(driver.calls[0]).toMatch(/begin/i);
    expect(driver.calls.some((c) => c.includes('SET LOCAL app.city_id'))).toBe(true);
    expect(driver.calls.some((c) => c.includes('SET LOCAL app.user_id'))).toBe(true);
    expect(driver.calls.some((c) => c.includes('SET LOCAL app.is_super_admin'))).toBe(true);
    expect(driver.calls.some((c) => c.includes('SET LOCAL app.request_id'))).toBe(true);
    expect(driver.calls[driver.calls.length - 1]).toMatch(/commit/i);
  });

  it('rolls back on fn error', async () => {
    const driver = new CaptureDriver();
    const db = makeDb(driver);

    await expect(
      runInTenantTx(
        db,
        { cityId: 'a', userId: 'b', isSuperAdmin: false, requestId: 'r' },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    expect(driver.calls[driver.calls.length - 1]).toMatch(/rollback/i);
  });
});
