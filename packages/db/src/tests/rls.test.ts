import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL ?? 'postgres://quart:quart@127.0.0.1:6432/quart';

let pool: pg.Pool;
let cityA: string;
let cityB: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: url, max: 2 });
  // Insert two cities directly via superuser (test-only setup)
  const admin = await pool.connect();
  try {
    cityA = randomUUID();
    cityB = randomUUID();
    await admin.query(
      `INSERT INTO cities (id, slug, name, country_code, locale_default, timezone, status)
       VALUES ($1, $2, 'TestA', 'IT', 'it', 'Europe/Rome', 'active')`,
      [cityA, `test-a-${Date.now()}`],
    );
    await admin.query(
      `INSERT INTO cities (id, slug, name, country_code, locale_default, timezone, status)
       VALUES ($1, $2, 'TestB', 'IT', 'it', 'Europe/Rome', 'active')`,
      [cityB, `test-b-${Date.now()}`],
    );
    await admin.query(`GRANT quart_app TO CURRENT_USER`); // make current user inherit
  } finally {
    admin.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe('RLS isolation', () => {
  it('A cannot read B city rows', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE quart_app`);
      await client.query(`SET LOCAL app.city_id = $1`, [cityA]);
      const r = await client.query(`SELECT count(*)::int FROM cities WHERE id = $1`, [cityB]);
      expect(r.rows[0].count).toBe(0);
    } finally {
      client.release();
    }
  });

  it('A can read its own city rows', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE quart_app`);
      await client.query(`SET LOCAL app.city_id = $1`, [cityA]);
      const r = await client.query(`SELECT count(*)::int FROM cities WHERE id = $1`, [cityA]);
      expect(r.rows[0].count).toBe(1);
    } finally {
      client.release();
    }
  });
});
