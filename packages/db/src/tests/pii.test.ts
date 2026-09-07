import pg from 'pg';
import { describe, it, expect, beforeAll } from 'vitest';

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://quart:quart@127.0.0.1:6432/quart';

describe('pgcrypto envelope (integration)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 1 });
  });

  it('encrypts and decrypts roundtrip via pgcrypto', async () => {
    const client = await pool.connect();
    try {
      const enc = await client.query(
        `SELECT pgp_sym_encrypt('hello-world', 'k', 'compress-algo=1, cipher-algo=aes256') AS c`,
      );
      const dec = await client.query(`SELECT pgp_sym_decrypt($1::bytea, 'k') AS p`, [
        enc.rows[0].c,
      ]);
      expect(dec.rows[0].p).toBe('hello-world');
    } finally {
      client.release();
    }
  });
});
