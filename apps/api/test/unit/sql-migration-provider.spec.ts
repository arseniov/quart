import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqlFileMigrationProvider } from '@quart/db';
import type { CompiledQuery, Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('SqlFileMigrationProvider', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sql-mig-'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(path.join(dir, '9999_test.up.sql'), 'SELECT 1;');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(path.join(dir, '9999_test.down.sql'), 'SELECT 2;');
    // Bogus files that must be ignored.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(path.join(dir, 'README.md'), '# nope');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(path.join(dir, '9999_test.up.ts'), 'export const up = async () => {};');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads .up.sql / .down.sql pairs and ignores everything else', async () => {
    const provider = new SqlFileMigrationProvider(dir);
    const migs = await provider.getMigrations();

    expect(Object.keys(migs)).toEqual(['9999_test']);
    expect(migs['9999_test'].up).toBeTypeOf('function');
    expect(migs['9999_test'].down).toBeTypeOf('function');
  });

  it('runs up and down by handing raw SQL to db.executeQuery(CompiledQuery.raw(...))', async () => {
    const provider = new SqlFileMigrationProvider(dir);
    const [name, migration] = Object.entries(await provider.getMigrations())[0]!;

    const calls: CompiledQuery[] = [];
    const fakeDb = {
      executeQuery: async (q: CompiledQuery) => {
        calls.push(q);
      },
    } as unknown as Kysely<unknown>;

    await migration.up!(fakeDb);
    await migration.down!(fakeDb);

    expect(calls.map((c) => c.sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect(calls.every((c) => c.parameters.length === 0)).toBe(true);
    expect(name).toBe('9999_test');
  });

  it('falls back to noop when only the up file is present', async () => {
    rmSync(path.join(dir, '9999_test.down.sql'));
    const migs = await new SqlFileMigrationProvider(dir).getMigrations();
    expect(migs['9999_test'].down).toBeTypeOf('function');

    const fakeDb = {
      executeQuery: async () => {
        throw new Error('down should be noop');
      },
    } as unknown as Kysely<unknown>;
    await expect(migs['9999_test'].down!(fakeDb)).resolves.toBeUndefined();
  });

  it('matches the format used by infrastructure/postgres/migrations', () => {
    // Sanity: ensures our regex accepts the real naming convention used in
    // 0001_geography.up.sql and 0016_fix_users_scope_policy.up.sql.
    const re = /^(?<name>\d{4}_[a-z0-9_]+)\.(?<dir>up|down)\.sql$/i;
    expect(re.test('0001_geography.up.sql')).toBe(true);
    expect(re.exec('0016_fix_users_scope_policy.down.sql')?.groups).toEqual({
      name: '0016_fix_users_scope_policy',
      dir: 'down',
    });
  });
});
