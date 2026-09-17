// gh #8 — sentinel (writeSystem) pathway coverage for the HMAC chain.
//
// The sentinel city `00000000-0000-0000-0000-000000000099` (seeded by
// migration 0038) lets pre-tenant auth events (magic-link request/consume,
// password reset) append to the HMAC chain. Migration 0040 unified the
// chain trigger so every row — sentinel or tenant — chain-links to the
// global head in id order. Same lock as 0038, single chain.
//
// What this spec asserts:
//   1. POST /auth/magic-link/request lands an `auth.magic_link_request`
//      row with city_id = sentinel, actor_user_id IS NULL, payload
//      stamped with SYSTEM_AUDIT_ACTOR.
//   2. A tenant write (POST /comments) lands a row with a real city_id
//      and a populated actor_user_id.
//   3. Reading audit_log in id order — every row's prev_hash equals the
//      immediately preceding row's row_hash (or GENESIS_PREV_HASH for
//      row 1) AND every row's row_hash matches the HMAC we'd recompute
//      from (prev_hash, payload_sha256, env.AUDIT_HMAC_KEY). The trigger
//      stamps each row's HMAC; this test reads it back and re-validates.
//   4. GET /admin/audit/verify returns status='ok' with `checked`
//      covering both sentinel and tenant rows — the controller's id-ASC
//      walk validates the unified chain end-to-end.

import { randomBytes, randomUUID } from 'node:crypto';

import { GENESIS_PREV_HASH, computeRowHash } from '@quart/db';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SYSTEM_AUDIT_CITY_ID } from '../../src/audit/audit.service.js';
import { JwtService } from '../../src/auth/jwt.service.js';

import { createTestApp, teardownTestApp, type CreateTestAppResult } from './fixtures/boot-app.js';
import { truncateAllTables } from './fixtures/cleanup.js';

const CITY_A = '22222222-2222-2222-2222-222222222222';
const ROLE_CITIZEN = 'citizen';
// 0022_seed_default_taxonomies — pothole category for Roma.
const CATEGORY_A_POTHOLE = 'ccccccc1-0000-0000-0000-000000000001';

interface FastifyLike {
  inject: (opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }) => Promise<{ statusCode: number; body: string; json: () => unknown }>;
}

interface UserRow {
  id: string;
  city_id: string;
}

interface SeededUser {
  id: string;
  cityId: string;
  token: string;
}

interface SentinelFixture {
  user: SeededUser;
  issueId: string;
}

type ChainRow = {
  id: string | number | bigint;
  city_id: string;
  actor_user_id: string | null;
  action: string;
  prev_hash: string;
  row_hash: string;
  payload_canonical_sha256: string;
};

describe('audit chain sentinel (writeSystem) pathway (e2e)', () => {
  let boot: CreateTestAppResult | undefined;
  let data: SentinelFixture | undefined;
  let jwt: JwtService | undefined;

  beforeAll(async () => {
    boot = await createTestApp();
    if (!boot || 'skipped' in boot) return;

    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;

    // ponytail: pin the active audit HMAC key in the DB to match
    // env.AUDIT_HMAC_KEY so trigger + verify agree. Same shim
    // audit-walk/full-flow specs use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (booted.db as any)
      .updateTable('quart_security.audit_key_versions')
      .set({ hmac_key_encrypted: () => sql`decode(${process.env.AUDIT_HMAC_KEY!}, 'hex')` })
      .where('status', '=', 'active')
      .execute();

    await truncateAllTables(booted.db);
    await truncateMagicLinks(booted.db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jwt = new JwtService({ env: { JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY!, JWT_ISSUER: process.env.JWT_ISSUER! } } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = booted.db as unknown as Kysely<any>;

    const hood = await seedNeighborhood(db, CITY_A);
    const citizen = await seedCitizen(db, CITY_A);
    const issueId = await seedIssue(db, citizen.id, CITY_A, hood.id);
    const user = await mintSession(db, jwt, citizen);

    data = { user, issueId };
  }, 120_000);

  afterAll(async () => {
    if (boot) await teardownTestApp(boot);
  });

  const skipIfNoDocker = (): boolean => !boot || 'skipped' in boot || !data || !jwt;
  const failSkip = (): never => {
    throw new Error('test precondition not met (docker or seed failure)');
  };

  // Run a real sentinel write (POST /auth/magic-link/request), then a real
  // tenant write (POST /comments), then read audit_log back in id order and
  // re-verify the chain end-to-end.
  //
  // This exercises:
  //   * 0040 chain trigger with the global head read (tenant rows now
  //     chain globally, courtesy of SECURITY DEFINER + the unified read)
  //   * writeSystem's super-admin branch on sentinel (app.is_super_admin=true
  //     + app.city_id=sentinel sets up audit_log RLS)
  //   * The tenant write path's per-city RLS context (app.city_id=CITY_A)
  //   * HMAC math (trigger stamps row_hash; this test recomputes it and
  //     matches).
  it('sentinel + tenant interleaved: each row.prev_hash === previous row.row_hash (id order)', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const d = data!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = booted.db as unknown as Kysely<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;

    // 1. Sentinel write. /auth/magic-link/request is @Public + @SkipTenant
    //    so the JwtAuthGuard is bypassed; MagicLinkService.issue() routes
    //    through AuditService.writeSystem which sets app.city_id =
    //    SYSTEM_AUDIT_CITY_ID inside its own trx + commits.
    const email = `sentinel-${randomBytes(4).toString('hex')}@example.com`;
    const magicLinkResp = await fastify.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email },
    });
    expect(magicLinkResp.statusCode, `magic-link: ${magicLinkResp.body}`).toBe(200);

    // 2. Tenant write. /comments goes through JwtAuthGuard + RbacGuard,
    //    runInTenantTx sets app.city_id = CITY_A / is_super_admin=false,
    //    and AuditInterceptor writes via AuditService.write (NOT writeSystem).
    const commentResp = await fastify.inject({
      method: 'POST',
      url: '/comments',
      headers: { authorization: `Bearer ${d.user.token}` },
      payload: { targetType: 'issue', targetId: d.issueId, body: 'sentinel pathway test' },
    });
    expect(commentResp.statusCode, `comment: ${commentResp.body}`).toBe(201);

    // 3. Read audit_log in id ASC and walk the chain manually — same
    //    invariant the verify controller checks, but spelled out so a
    //    regression names the exact row that broke.
    const rows = (await db
      .selectFrom('audit_log')
      .select(['id', 'city_id', 'actor_user_id', 'action', 'prev_hash', 'row_hash', 'payload_canonical_sha256'])
      .orderBy('id', 'asc')
      .execute()) as unknown as ChainRow[];
    expect(rows.length, 'expected sentinel + tenant rows at minimum').toBeGreaterThanOrEqual(2);

    const sentinelRow = rows.find(
      (r) => r.action === 'auth.magic_link_request' && r.city_id === SYSTEM_AUDIT_CITY_ID,
    );
    const tenantRow = rows.find(
      (r) =>
        r.action === 'comment.create' &&
        r.city_id === CITY_A &&
        r.actor_user_id === d.user.id,
    );
    expect(sentinelRow, 'sentinel row missing').toBeDefined();
    expect(tenantRow, 'tenant row missing').toBeDefined();
    // Sentinel marker: actor_user_id NULL + the payload stamped with
    // SYSTEM_AUDIT_ACTOR by AuditService.buildSystemRow.
    expect(sentinelRow!.actor_user_id).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payloadRow = (await (db as any)
      .selectFrom('audit_log')
      .select('payload_redacted')
      .where('id', '=', sentinelRow!.id)
      .executeTakeFirstOrThrow()) as { payload_redacted: { actor?: string } };
    expect(payloadRow.payload_redacted.actor).toBe('system@quart.app');

    // 4. Walk the chain in id order: prev_hash links to the row above,
    //    row_hash recomputes from HMAC(prev_hash, payload_sha, env key).
    let expectedPrev = GENESIS_PREV_HASH;
    for (const row of rows) {
      expect(row.prev_hash, `row id=${String(row.id)} action=${row.action}`).toBe(expectedPrev);
      const recomputed = computeRowHash(
        { prev_hash: row.prev_hash, payload_canonical_sha256: row.payload_canonical_sha256 },
        process.env.AUDIT_HMAC_KEY!,
      );
      expect(row.row_hash, `row_hash mismatch id=${String(row.id)} action=${row.action}`).toBe(recomputed);
      expectedPrev = row.row_hash;
    }

    // 5. Belt-and-suspenders: the sentinel's prev_hash is the row_hash of
    //    whatever row was in id position N-1 (the trigger's GLOBAL head —
    //    whatever city it belonged to). Pin it to the immediately preceding
    //    row in id order; if sentinel was inserted between two tenant
    //    rows, that's exactly the global head at that moment.
    const idx = rows.findIndex((r) => r.id === sentinelRow!.id);
    if (idx > 0) {
      expect(sentinelRow!.prev_hash).toBe(rows[idx - 1]!.row_hash);
    } else {
      expect(sentinelRow!.prev_hash).toBe(GENESIS_PREV_HASH);
    }
  });

  it('walks globally: GET /admin/audit/verify validates sentinel and tenant rows together', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const d = data!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance() as FastifyLike;

    // Add another sentinel + tenant row on top of whatever the previous
    // test left. The verify controller walks the entire table by id ASC,
    // so it MUST see sentinel + tenant rows in one chain — verifying the
    // end-to-end integration the brief asks for.
    const email = `sentinel-verify-${randomBytes(4).toString('hex')}@example.com`;
    const magicLinkResp = await fastify.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email },
    });
    expect(magicLinkResp.statusCode, `magic-link: ${magicLinkResp.body}`).toBe(200);
    const commentResp = await fastify.inject({
      method: 'POST',
      url: '/comments',
      headers: { authorization: `Bearer ${d.user.token}` },
      payload: { targetType: 'issue', targetId: d.issueId, body: 'verify walk sentinel pathway test' },
    });
    expect(commentResp.statusCode, `comment: ${commentResp.body}`).toBe(201);

    const verify = await fastify.inject({
      method: 'GET',
      url: '/admin/audit/verify',
      headers: { authorization: `Bearer ${d.user.token}` },
    });
    expect(verify.statusCode, `verify: ${verify.body}`).toBe(200);
    const body = verify.json() as { status: string; checked: number; reachedLimit: boolean };
    expect(body.status).toBe('ok');
    expect(body.checked).toBeGreaterThanOrEqual(2);
    expect(body.reachedLimit).toBe(false);
  });
});

// ------------------------------------------------------------------helpers

async function truncateMagicLinks(db: Kysely<unknown>): Promise<void> {
  // magic_links is not in cleanup.ts's TENANT_TABLES list — production
  // seeds it independently and other specs don't touch it, but the
  // sentinel spec issues tokens per-test, so wipe it on boot to keep
  // tests hermetic.
  await sql.raw(`TRUNCATE TABLE magic_links RESTART IDENTITY CASCADE`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .execute(db as any)
    .catch(() => undefined);
}

async function seedNeighborhood(db: Kysely<unknown>, cityId: string): Promise<{ id: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const slug = `sentinel-${cityId.slice(0, 8)}-${randomBytes(3).toString('hex')}`;
  const row = await d
    .insertInto('neighborhoods')
    .values({
      city_id: cityId,
      slug,
      name: `Sentinel ${cityId.slice(0, 8)}`,
      geometry: sql`ST_GeogFromText('SRID=4326;MULTIPOLYGON(((0 0,0 1,1 1,1 0,0 0)))')`,
      centroid: sql`ST_GeogFromText('SRID=4326;POINT(0.5 0.5)')`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id as string };
}

async function seedCitizen(db: Kysely<unknown>, cityId: string): Promise<UserRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const suffix = randomBytes(4).toString('hex');
  const userRes = await d
    .insertInto('users')
    .values({
      handle: `sentinel-${suffix}`,
      email: `sentinel-${suffix}@example.com`,
      display_name: 'SENTINEL',
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
    .values({ user_id: userRes.id, role_id: roleRes.id, city_id: cityId })
    .execute();
  return { id: userRes.id, city_id: cityId };
}

async function seedIssue(
  db: Kysely<unknown>,
  userId: string,
  cityId: string,
  neighborhoodId: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const point: [number, number] = [12.5, 41.9];
  const row = await d
    .insertInto('issues')
    .values({
      city_id: cityId,
      neighborhood_id: neighborhoodId,
      category_id: CATEGORY_A_POTHOLE,
      author_user_id: userId,
      title: 'sentinel pathway test issue',
      description: 'seeded for audit-sentinel e2e',
      location: sql`ST_GeogFromText('SRID=4326;POINT(${sql.lit(point[0])} ${sql.lit(point[1])})')`,
      status: 'open',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id as string;
}

async function mintSession(db: Kysely<unknown>, jwt: JwtService, user: UserRow): Promise<SeededUser> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  const sessionId = randomUUID();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await d
    .insertInto('auth_sessions')
    .values({
      id: sessionId,
      user_id: user.id,
      user_agent: 'audit-sentinel-e2e',
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
  return { id: user.id, cityId: user.city_id, token };
}
