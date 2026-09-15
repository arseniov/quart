import { randomBytes, randomUUID } from 'node:crypto';

import { GENESIS_PREV_HASH } from '@quart/db';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtService } from '../../src/auth/jwt.service.js';

import { createTestApp, teardownTestApp, type CreateTestAppResult } from './fixtures/boot-app.js';
import { truncateAllTables } from './fixtures/cleanup.js';

// Roma (city A) — fixed UUID from 0020_seed_italy, same as rls-isolation spec.
const CITY_A = '22222222-2222-2222-2222-222222222222';
const CITY_B = '33333333-3333-3333-3333-333333333333';
const ROLE_CITIZEN = 'citizen';

interface SeededUser {
  id: string;
  cityId: string;
  jti: string;
  token: string;
}

interface FixtureData {
  citizenA: SeededUser;
  citizenB: SeededUser;
}

interface FastifyLike {
  inject: (opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) => Promise<{ statusCode: number; body: string; json: () => unknown }>;
}

describe('audit chain walk (e2e)', () => {
  let boot: CreateTestAppResult | undefined;
  let data: FixtureData | undefined;
  let jwt: JwtService | undefined;

  beforeAll(async () => {
    boot = await createTestApp();
    if (!boot || 'skipped' in boot) return;

    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;

    // ponytail: 0023 seeds `audit_key_versions.hmac_key_encrypted` with
    // `gen_random_bytes(32)` per environment; the BEFORE-INSERT trigger
    // (0014) stamps every audit row with that key. The verify controller
    // recomputes the chain using `config.env.AUDIT_HMAC_KEY` — for the
    // two to agree in this hermetic boot we override the DB-stored key
    // to match the env value the harness seeded. Mirrors what production
    // would do via the KMS handoff at app startup.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (booted.db as any)
      .updateTable('quart_security.audit_key_versions')
      .set({ hmac_key_encrypted: () => sql`decode(${process.env.AUDIT_HMAC_KEY!}, 'hex')` })
      .where('status', '=', 'active')
      .execute();

    await truncateAllTables(booted.db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jwt = new JwtService({ env: { JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY!, JWT_ISSUER: process.env.JWT_ISSUER! } } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = booted.db as unknown as Kysely<any>;

    const citizenA = await seedUser(db, CITY_A, 'audit-a');
    const citizenB = await seedUser(db, CITY_B, 'audit-b');

    // VerifyController only requires JwtAuthGuard + MfaGuard (no RbacGuard),
    // and MfaGuard only enforces MFA for officer roles — citizens pass through.
    data = {
      citizenA: await mintSession(db, jwt, citizenA),
      citizenB: await mintSession(db, jwt, citizenB),
    };
  }, 120_000);

  afterAll(async () => {
    if (boot) await teardownTestApp(boot);
  });

  const skipIfNoDocker = (): boolean => !boot || 'skipped' in boot || !data || !jwt;
  const failSkip = (): never => {
    throw new Error('test precondition not met (docker or seed failure)');
  };

  it('GET /admin/audit/verify without auth returns 401', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;

    const resp = await fastify.inject({
      method: 'GET',
      url: '/admin/audit/verify',
    });
    expect(resp.statusCode).toBe(401);
  });

  it('GET /admin/audit/verify as authenticated citizen returns ok with zero rows on a fresh log', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;
    const d = data!;

    const resp = await fastify.inject({
      method: 'GET',
      url: '/admin/audit/verify',
      headers: { authorization: `Bearer ${d.citizenA.token}` },
    });
    expect(resp.statusCode, `response: ${resp.body}`).toBe(200);
    const body = resp.json() as { status: string; checked: number; reachedLimit: boolean };
    expect(body.status).toBe('ok');
    expect(body.checked).toBe(0);
    expect(body.reachedLimit).toBe(false);
  });

  it('GET /admin/audit/verify detects activity: after an idea write, checked > 0', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = booted.db as unknown as Kysely<any>;
    const d = data!;

    // Synthesise an audit row the same way IdeasService.create() does,
// using the SAME HMAC the audit service uses (the boot harness seeds
// AUDIT_HMAC_KEY in env). Cheaper than a full POST /ideas (which
// needs RbacGuard + neighborhood seed) and keeps the test hermetic.
    //
    // The BEFORE-INSERT trigger (0014) overrides our row_hash with one
    // computed from the active audit_key_versions row. We've pinned that
    // row's bytes to env.AUDIT_HMAC_KEY above so trigger + verify agree.
    const payloadSha = 'a'.repeat(64);
    const kvId = await activeAuditKeyVersionId(db);
    await runInTenantTxWithCitizen(db, d.citizenA, async (trx) => {
      await trx
        .insertInto('audit_log')
        .values({
          city_id: d.citizenA.cityId,
          actor_user_id: d.citizenA.id,
          on_behalf_of_user_id: null,
          action: 'idea.create',
          target_type: 'idea',
          target_id: randomUUID(),
          request_id: randomUUID(),
          ip: null,
          user_agent: 'audit-walk-e2e',
          payload_canonical_sha256: payloadSha,
          payload_redacted: JSON.stringify({ title: 'audit-walk-test' }),
          prev_hash: GENESIS_PREV_HASH,
          row_hash: GENESIS_PREV_HASH,
          key_version_id: kvId,
        })
        .execute();
    });

    const resp = await fastify.inject({
      method: 'GET',
      url: '/admin/audit/verify',
      headers: { authorization: `Bearer ${d.citizenA.token}` },
    });
    expect(resp.statusCode, `response: ${resp.body}`).toBe(200);
    const body = resp.json() as { status: string; checked: number; brokenAtId?: string };
    expect(body.status).toBe('ok');
    expect(body.checked).toBeGreaterThanOrEqual(1);
  });

  it('GET /admin/audit/verify detects a tampered row_hash and reports brokenAtId', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = booted.db as unknown as Kysely<any>;
    const d = data!;

    // Snapshot the chain length before tampering so the assertion can pin
    // down the broken row by id.
    const before = (await sql<{ c: number }>`SELECT count(*)::int AS c FROM audit_log`.execute(db))
      .rows[0]?.c;

    // Insert a row whose prev_hash chains from the previous row's row_hash
    // (so the walker reaches it) but whose row_hash is bogus (so it breaks
    // at THIS row, not an earlier one). citizenB's city matches its tenant.
    const lastRowHash = (
      await sql<{ row_hash: string }>`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`.execute(db)
    ).rows[0]?.row_hash ?? GENESIS_PREV_HASH;
    const tamperedId = (
      await sql`INSERT INTO audit_log (
          city_id, actor_user_id, action, target_type, target_id, request_id,
          payload_canonical_sha256, payload_redacted, prev_hash, row_hash, key_version_id
        ) VALUES (
          ${d.citizenB.cityId}, ${d.citizenB.id}, 'test.tamper', 'synthetic', ${randomUUID()}, ${randomUUID()},
          ${'b'.repeat(64)}, '{}'::jsonb, ${lastRowHash}, ${'c'.repeat(64)}, ${await activeAuditKeyVersionId(db)}
        ) RETURNING id`.execute(db)
    ).rows[0]?.id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;
    const resp = await fastify.inject({
      method: 'GET',
      url: '/admin/audit/verify',
      headers: { authorization: `Bearer ${d.citizenB.token}` },
    });
    expect(resp.statusCode, `response: ${resp.body}`).toBe(200);
    const body = resp.json() as { status: string; checked: number; brokenAtId?: string };

    expect(body.status).toBe('broken');
    expect(body.checked).toBeGreaterThanOrEqual(0);
    expect(body.checked).toBeLessThan((before ?? 0) + 1);
    expect(String(body.brokenAtId)).toBe(String(tamperedId));
  });
});

// ------------------------------------------------------------------helpers

interface UserRow {
  id: string;
  city_id: string;
}

async function seedUser(db: Kysely<never>, cityId: string, tag: string): Promise<UserRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const suffix = randomBytes(4).toString('hex');
  const userRes = await d
    .insertInto('users')
    .values({
      handle: `${tag}-${suffix}`,
      email: `${tag}-${suffix}@example.com`,
      display_name: tag.toUpperCase(),
      default_city_id: cityId,
    })
    .returning(['id', 'default_city_id'])
    .executeTakeFirstOrThrow();

  const roleRes = await d
    .selectFrom('roles')
    .select('id')
    .where('code', '=', ROLE_CITIZEN)
    .executeTakeFirstOrThrow();
  await d
    .insertInto('user_roles')
    .values({
      user_id: userRes.id,
      role_id: roleRes.id,
      city_id: cityId,
    })
    .execute();

  return { id: userRes.id, city_id: cityId };
}

async function mintSession(db: Kysely<never>, jwt: JwtService, user: UserRow): Promise<SeededUser> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const sessionId = randomUUID();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await d
    .insertInto('auth_sessions')
    .values({
      id: sessionId,
      user_id: user.id,
      user_agent: 'audit-walk-e2e',
      absolute_expires_at: expires,
    })
    .execute();

  const token = await jwt.sign(
    {
      sub: user.id,
      city_id: user.city_id,
      scope_type: 'city',
      scope_id: user.city_id,
      role_snapshot: [ROLE_CITIZEN],
      device_fingerprint: null,
    },
    { jti: sessionId, ttlSeconds: 3600 },
  );
  return { id: user.id, cityId: user.city_id, jti: sessionId, token };
}

async function activeAuditKeyVersionId(db: Kysely<unknown>): Promise<string> {
  const row = (await sql<{ id: string }>`SELECT id FROM quart_security.audit_key_versions WHERE status = 'active' LIMIT 1`.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db as any,
  )).rows[0];
  if (!row) throw new Error('no active audit_key_version (migration 0023 should seed one)');
  return row.id;
}

// Run a callback with the per-request tenant RLS GUCs set so the inner
// queries can insert into `audit_log`/`ideas` as the right role. Same
// pattern as the JwtAuthGuard would do at HTTP time.
async function runInTenantTxWithCitizen<T>(
  db: Kysely<unknown>,
  user: SeededUser,
  fn: (trx: Kysely<unknown>) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const k = db as any;
  return k.transaction().execute(async (trx: Kysely<unknown>) => {
    const cityLit = `'${user.cityId.replace(/'/g, "''")}'`;
    const userLit = `'${user.id.replace(/'/g, "''")}'`;
    const reqLit = `'audit-walk-e2e'`;
    await sql
      .raw(
        `SET LOCAL ROLE quart_app;\n` +
          `SET LOCAL app.city_id = ${cityLit};\n` +
          `SET LOCAL app.user_id = ${userLit};\n` +
          `SET LOCAL app.is_super_admin = false;\n` +
          `SET LOCAL app.request_id = ${reqLit};`,
      )
      .execute(trx);
    return fn(trx);
  });
}