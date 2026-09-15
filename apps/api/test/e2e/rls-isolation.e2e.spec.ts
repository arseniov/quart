import { randomBytes, randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtService } from '../../src/auth/jwt.service.js';
import { runInTenantTx } from '../../src/db/run-in-tenant-tx.js';

import { createTestApp, teardownTestApp, type CreateTestAppResult } from './fixtures/boot-app.js';
import { truncateAllTables } from './fixtures/cleanup.js';

// Roma (city A) and Milan (city B) are seeded by migration 0020 with fixed
// UUIDs the rest of the project references; reuse them rather than minting
// new IDs so other e2e fixtures and seed data remain compatible.
const CITY_A = '22222222-2222-2222-2222-222222222222'; // Roma
const CITY_B = '33333333-3333-3333-3333-333333333333'; // Milano

// 0022 pre-seeds pothole / streetlight categories for both cities.
const CATEGORY_A_POTHOLE = 'ccccccc1-0000-0000-0000-000000000001';

const ROLE_CITIZEN = 'citizen';

// Coords inside each city's seeded bounds polygon so inferNeighborhood can
// resolve a neighborhood without needing a point-in-polygon hit. Roma is
// ~12.5,41.9; Milan is ~9.2,45.5.
const POINT_A: [number, number] = [12.5, 41.9];
const POINT_B: [number, number] = [9.2, 45.5];

interface SeededUser {
  id: string;
  cityId: string;
  jti: string;
  token: string;
}

interface FixtureData {
  userA: SeededUser;
  userB: SeededUser;
  issueAId: string;
}

describe('rls isolation (e2e)', () => {
  let boot: CreateTestAppResult | undefined;
  let data: FixtureData | undefined;
  // Local JwtService — the app's instance is bound to the same JWT_SIGNING_KEY
  // the test env sets (boot-app.ts), so signing locally produces a token the
  // real JwtAuthGuard accepts.
  let jwt: JwtService;

  beforeAll(async () => {
    boot = await createTestApp();
    if (!boot || 'skipped' in boot) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jwt = new JwtService({ env: { JWT_SIGNING_KEY: process.env.JWT_SIGNING_KEY!, JWT_ISSUER: process.env.JWT_ISSUER! } } as any);

    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    await truncateAllTables(booted.db);

    const userA = await seedUser(booted.db as unknown as Kysely<never>, CITY_A, 'rls-a');
    const userB = await seedUser(booted.db as unknown as Kysely<never>, CITY_B, 'rls-b');
    const issueAId = await seedIssue(booted.db as unknown as Kysely<never>, userA.id, CITY_A, CATEGORY_A_POTHOLE);

    data = {
      userA: await mintSession(booted.db as unknown as Kysely<never>, jwt, userA),
      userB: await mintSession(booted.db as unknown as Kysely<never>, jwt, userB),
      issueAId,
    };
  }, 120_000);

  afterAll(async () => {
    if (boot) await teardownTestApp(boot);
  });

  const skipIfNoDocker = (): boolean => !boot || 'skipped' in boot || !data;
  const failSkip = (): never => {
    throw new Error('test precondition not met (docker or seed failure)');
  };

  it('API: user A reads their issue from city A; user B reads empty from city B', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance();
    const d = data!;

    const aResp = await fastify.inject({
      method: 'GET',
      url: `/issues?cityId=${CITY_A}`,
      headers: { authorization: `Bearer ${d.userA.token}` },
    });
    expect(aResp.statusCode, `A response: ${aResp.body}`).toBe(200);
    const aBody = aResp.json();
    expect(Array.isArray(aBody)).toBe(true);
    expect(aBody).toHaveLength(1);
    expect(aBody[0].id).toBe(d.issueAId);

    const bResp = await fastify.inject({
      method: 'GET',
      url: `/issues?cityId=${CITY_B}`,
      headers: { authorization: `Bearer ${d.userB.token}` },
    });
    expect(bResp.statusCode, `B response: ${bResp.body}`).toBe(200);
    expect(bResp.json()).toEqual([]);
  });

  it('API: user B reading city A returns [] — RLS hides data even when the queried cityId is foreign', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fastify = (booted.app as any).getHttpAdapter().getInstance();
    const d = data!;

    const resp = await fastify.inject({
      method: 'GET',
      url: `/issues?cityId=${CITY_A}`,
      headers: { authorization: `Bearer ${d.userB.token}` },
    });
    expect(resp.statusCode, `response: ${resp.body}`).toBe(200);
    expect(resp.json()).toEqual([]);
  });

  it('DB: tenant tx with app.city_id=A reads only A; with B reads only B (or empty)', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const d = data!;

    const rowsA = await runInTenantTx(
      booted.db as unknown as Kysely<never>,
      { cityId: CITY_A, userId: d.userA.id, isSuperAdmin: false, requestId: 'rls-test-a' },
      async (trx) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (trx as any)
          .selectFrom('issues')
          .selectAll()
          .execute() as Promise<{ id: string; city_id: string }[]>,
    );
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsA.every((r) => r.city_id === CITY_A)).toBe(true);
    expect(rowsA.some((r) => r.id === d.issueAId)).toBe(true);

    const rowsB = await runInTenantTx(
      booted.db as unknown as Kysely<never>,
      { cityId: CITY_B, userId: d.userB.id, isSuperAdmin: false, requestId: 'rls-test-b' },
      async (trx) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (trx as any)
          .selectFrom('issues')
          .selectAll()
          .execute() as Promise<{ id: string; city_id: string }[]>,
    );
    expect(rowsB.every((r) => r.city_id === CITY_B)).toBe(true);
    expect(rowsB.some((r) => r.id === d.issueAId)).toBe(false);
  });

  it('GUC: current_setting(app.city_id) reflects the tenant context inside each tx', async () => {
    if (skipIfNoDocker()) return failSkip();
    const booted = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const d = data!;

    const gucA = await runInTenantTx(
      booted.db as unknown as Kysely<never>,
      { cityId: CITY_A, userId: d.userA.id, isSuperAdmin: false, requestId: 'rls-guc-a' },
      async (trx) => {
        const r = await sql<{ v: string }>`SELECT current_setting('app.city_id', true) AS v`.execute(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trx as any,
        );
        return r.rows[0]?.v;
      },
    );
    expect(gucA).toBe(CITY_A);

    const gucB = await runInTenantTx(
      booted.db as unknown as Kysely<never>,
      { cityId: CITY_B, userId: d.userB.id, isSuperAdmin: false, requestId: 'rls-guc-b' },
      async (trx) => {
        const r = await sql<{ v: string }>`SELECT current_setting('app.city_id', true) AS v`.execute(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trx as any,
        );
        return r.rows[0]?.v;
      },
    );
    expect(gucB).toBe(CITY_B);
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
  // 0021 grants `citizen` the `content.read` permission needed for GET /issues.
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

async function seedIssue(db: Kysely<never>, userId: string, cityId: string, categoryId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  // issues.neighborhood_id is NOT NULL, so each city needs at least one
  // neighborhood to attach issues to. Create one per test city.
  const neighRes = await d
    .insertInto('neighborhoods')
    .values({
      city_id: cityId,
      slug: `rls-${randomBytes(3).toString('hex')}`,
      name: `RLS Test ${cityId.slice(0, 8)}`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const point = cityId === CITY_A ? POINT_A : POINT_B;
  const issueRes = await d
    .insertInto('issues')
    .values({
      city_id: cityId,
      neighborhood_id: neighRes.id,
      category_id: categoryId,
      author_user_id: userId,
      title: 'rls isolation test issue',
      description: 'seeded for cross-city RLS verification',
      // ST_GeogFromText needs the WKT inside the SQL; literal interpolation
      // is safe because point values are numeric constants.
      location: sql`ST_GeogFromText('SRID=4326;POINT(${sql.lit(point[0])} ${sql.lit(point[1])})')`,
      status: 'open',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return issueRes.id as string;
}

async function mintSession(db: Kysely<never>, jwt: JwtService, user: UserRow): Promise<SeededUser> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = db as any;
  // The JwtAuthGuard joins claims->session by `jti === auth_sessions.id`,
  // so the JWT `jti` claim must equal the inserted session id (a UUID).
  const sessionId = randomUUID();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  await d
    .insertInto('auth_sessions')
    .values({
      id: sessionId,
      user_id: user.id,
      user_agent: 'rls-isolation-e2e',
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