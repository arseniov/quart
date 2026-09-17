import { randomBytes, randomUUID } from 'node:crypto';

import { createDb, encryptPii, type DB } from '@quart/db';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, teardownTestApp, type CreateTestAppResult } from './fixtures/boot-app.js';

// Roma (city A) + Milano (city B) — fixed UUIDs from 0020_seed_italy.
const CITY_A = '22222222-2222-2222-2222-222222222222';
const CITY_B = '33333333-3333-3333-3333-333333333333';

// Synthetic table that doesn't exist in the real schema but is registered
// as a `pgp_sym` PII column. We add a matching `pii_test_cipher` bytea column
// below via raw SQL inside the spec's beforeAll so the round-trip can
// actually round-trip through SELECT.
const TEST_TABLE = '_pii_e2e_test';
const TEST_COLUMN = 'secret_value';
const TEST_CIPHER_COLUMN = 'secret_cipher';

describe('pii roundtrip (e2e)', () => {
  let boot: CreateTestAppResult | undefined;
  // A bare DB handle whose connections SET LOCAL `app.kek_material` before
  // any encrypt/decrypt call. The harness's `booted.db` uses a fresh
  // connection per call from the pool, so we wrap each call in a tiny
  // helper that sets the GUC on the same connection Kysely hands us.
  let piiDb: Kysely<DB> | undefined;
  // Stable KEK so the test is reproducible across runs. 32 bytes hex.
  const KEK_HEX = 'd'.repeat(64);

  beforeAll(async () => {
    boot = await createTestApp();
    if (!boot || 'skipped' in boot) return;

    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    await setupPiiKeys(booted.db as unknown as Kysely<never>, KEK_HEX);

    // Build a dedicated Kysely whose every query begins with a GUC setter.
    // The harness already set KEK_BASE64 in env; the `app.kek_material` GUC
    // is per-session so we have to SET LOCAL on the same connection the
    // query runs on. Kysely's per-query `connection()` call wraps it.
     
    piiDb = createDb({ connectionString: process.env.DATABASE_URL! }) as unknown as Kysely<DB>;
  }, 120_000);

  afterAll(async () => {
    if (boot) {
      // Drop the synthetic table so a subsequent run starts clean even if
      // the truncate helper isn't told about it.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await sql.raw(`DROP TABLE IF EXISTS ${TEST_TABLE}`).execute((boot as any).db);
      } catch {
        // ignore
      }
      await teardownTestApp(boot);
    }
  });

  const skipIfNoDocker = (): boolean => !boot || 'skipped' in boot || !piiDb;
  const failSkip = (): never => {
    throw new Error('test precondition not met (docker or seed failure)');
  };

  it('encryptPii returns a hex string for a registered pgp_sym column', async () => {
    if (skipIfNoDocker()) return failSkip();
    const cipher = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext: 'a@b.c' }),
    );
    expect(typeof cipher).toBe('string');
    // pgp_sym_encrypt returns bytea which pg encodes as a hex-escaped
    // string starting with \x when round-tripped through text. Either
    // the \x-prefixed form or a raw hex string is acceptable, but both
    // are pure hex + a leading \x marker.
    expect(cipher).toMatch(/^(\\x)?[0-9a-f]+$/i);
  });

  it('encrypt → decrypt round-trips the plaintext', async () => {
    if (skipIfNoDocker()) return failSkip();
    const plaintext = `sensitive value ${randomBytes(4).toString('hex')}`;

    const cipher = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext }),
    );
    const decrypted = await withKek(piiDb!, KEK_HEX, (db) =>
      decryptPii(db, CITY_A, TEST_TABLE, TEST_COLUMN, cipher),
    );
    expect(decrypted).toBe(plaintext);
  });

  it('two encrypts of the same plaintext return different ciphertexts (IV randomization)', async () => {
    if (skipIfNoDocker()) return failSkip();
    const plaintext = 'same input';

    const a = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext }),
    );
    const b = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext }),
    );

    expect(a).not.toBe(b);
    // Both must still decrypt back to the original.
    const pa = await withKek(piiDb!, KEK_HEX, (db) =>
      decryptPii(db, CITY_A, TEST_TABLE, TEST_COLUMN, a),
    );
    const pb = await withKek(piiDb!, KEK_HEX, (db) =>
      decryptPii(db, CITY_A, TEST_TABLE, TEST_COLUMN, b),
    );
    expect(pa).toBe(plaintext);
    expect(pb).toBe(plaintext);
  });

  it('decrypting a city-A cipher with city-B throws (wrong key version)', async () => {
    if (skipIfNoDocker()) return failSkip();
    const plaintext = 'city-locked secret';

    const cipher = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext }),
    );
    await expect(
      withKek(piiDb!, KEK_HEX, (db) => decryptPii(db, CITY_B, TEST_TABLE, TEST_COLUMN, cipher)),
    ).rejects.toThrow();
  });

  it('round-trips a PII value through a real table column (insert → select → decrypt)', async () => {
    if (skipIfNoDocker()) return failSkip();
    const plaintext = `row-level secret ${randomBytes(4).toString('hex')}`;
    const rowId = randomUUID();

    // Encrypt via the API surface, then store the cipher bytes in the
    // synthetic test table's `bytea` column. Decrypt via SQL helper to
    // prove the bytea path is bit-identical to in-place usage.
    const cipher = await withKek(piiDb!, KEK_HEX, (db) =>
      encryptPii(db, { city_id: CITY_A, table: TEST_TABLE, column: TEST_COLUMN, plaintext }),
    );
    // pgp_sym_encrypt output is bytea; `encryptPii` returns it hex-encoded
    // so we can hand it back through `decode(..., 'hex')` for storage and
    // for the SQL helper in the SELECT below.
    await withKek(piiDb!, KEK_HEX, async (db) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .insertInto(TEST_TABLE)
        .values({ id: rowId, secret_cipher: sql`decode(${cipher}, 'hex')` })
        .execute();
    });

    const decrypted = await withKek(piiDb!, KEK_HEX, async (db) => {
      const row = await sql<{ v: string }>`SELECT quart_security.pgp_sym_decrypt_for_column(
        secret_cipher, ${TEST_TABLE}, ${TEST_COLUMN}, ${CITY_A}
      ) AS v FROM ${sql.raw(TEST_TABLE)} WHERE id = ${rowId}`.execute(db);
      return row.rows[0]?.v;
    });
    expect(decrypted).toBe(plaintext);
  });
});

// ------------------------------------------------------------------helpers

/**
 * Seed the per-city DEK + column registration + the synthetic test table.
 * The migration 0007 leaves `pii_key_versions` empty — production seeds it
 * via the rotation worker, but tests want hermetic, deterministic keys.
 */
async function setupPiiKeys(db: Kysely<never>, kekHex: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;

  // Synthetic test table holding encrypted PII. Uses a real pgcrypto bytea
  // column so we can exercise SELECT round-trips.
  await sql
    .raw(
      `CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (id uuid PRIMARY KEY, ${TEST_CIPHER_COLUMN} bytea)`,
    )
    .execute(d);

  // Resolve the active KEK row (seeded by 0023) so we can register a
  // pgp_sym column pointing at it.
  const kekRes = await d.executeQuery(
    CompiledQuery.raw(
      `SELECT id FROM quart_security.kek_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1`,
    ),
  );
  const kekRow = kekRes.rows[0] as { id: string } | undefined;
  if (!kekRow) throw new Error('no active kek_version seeded (migration 0023 should seed one)');
  const kekId = kekRow.id;

  // Wrap a fresh DEK per city with the KEK via pgcrypto. Both args are
  // explicitly cast to text so Postgres doesn't infer the second one as
  // a hex bytea literal (a 64-char string of `[0-9a-f]` looks bytea-ish).
  // No `compress-algo` here — `pii_dek` (migration 0007) calls
  // `pgp_sym_decrypt_bytea` without options, so the wrap must use defaults.
  for (const cityId of [CITY_A, CITY_B]) {
    const dek = randomBytes(32);
    const dekHex = dek.toString('hex');
    const wrapRes = await d.executeQuery(
      CompiledQuery.raw(
        `SELECT encode(pgp_sym_encrypt('${dekHex}'::text, '${kekHex}'::text, 'cipher-algo=aes256'), 'hex') AS c`,
      ),
    );
    const wrappedHex = (wrapRes.rows[0] as { c: string } | undefined)?.c;
    if (!wrappedHex) throw new Error('failed to wrap DEK with KEK');

    // Mark any existing active version as retiring so the partial unique
    // index doesn't reject the insert on re-run.
    await d.executeQuery(
      CompiledQuery.raw(
        `UPDATE pii_key_versions SET status = 'retiring' WHERE city_id = '${cityId}' AND status = 'active'`,
      ),
    );
    await d.executeQuery(
      CompiledQuery.raw(
        `INSERT INTO pii_key_versions (city_id, version, status, dek_encrypted, kek_id, activated_at)
         VALUES ('${cityId}', 1, 'active', decode('${wrappedHex}', 'hex'), '${kekId}', now())`,
      ),
    );
  }

  // Register the synthetic (table, column) pair as a pgp_sym PII column
  // pointing at the active KEK. Idempotent on re-run via ON CONFLICT.
  await d.executeQuery(
    CompiledQuery.raw(
      `INSERT INTO pii_columns (table_name, column_name, encryption_mode, kek_id)
         VALUES ('${TEST_TABLE}', '${TEST_COLUMN}', 'pgp_sym', '${kekId}')
       ON CONFLICT (table_name, column_name) DO NOTHING`,
    ),
  );
}

/**
 * Inverse of {@link encryptPii} for the registered pgp_sym mode. The
 * matching SQL helper is `quart_security.pgp_sym_decrypt_for_column`;
 * keeping it inline avoids dragging a new export into `@quart/db`.
 * `cipher` arrives as a hex string (the same shape `encryptPii` returns);
 * cast through `decode(..., 'hex')` so the SQL function gets bytea.
 */
async function decryptPii(
  db: Kysely<DB>,
  cityId: string,
  table: string,
  column: string,
  cipher: string,
): Promise<string> {
  const rows = await sql<{ p: string }>`SELECT quart_security.pgp_sym_decrypt_for_column(
    decode(${cipher}, 'hex'), ${table}, ${column}, ${cityId}
  ) AS p`.execute(db);
  if (!rows.rows[0]) throw new Error('pgp_sym_decrypt_for_column returned no row');
  return rows.rows[0].p;
}

/**
 * Run `fn` with the per-connection `app.kek_material` GUC set so the SQL
 * helpers in 0007_pii can unwrap the per-city DEK. SET LOCAL is scoped to
 * the current transaction, so `fn` runs inside an explicit transaction
 * whose lifetime is the lifetime of the GUC.
 */
async function withKek<T>(
  db: Kysely<DB>,
  kekHex: string,
  fn: (db: Kysely<DB>) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).transaction().execute(async (trx: Kysely<DB>) => {
    await trx
      .executeQuery(
        CompiledQuery.raw(`SET LOCAL app.kek_material = '${kekHex}'`),
      );
    return fn(trx);
  });
}