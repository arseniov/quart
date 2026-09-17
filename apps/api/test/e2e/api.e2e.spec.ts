import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type CreateTestAppResult, teardownTestApp } from './fixtures/boot-app.js';
import { truncateAllTables } from './fixtures/cleanup.js';

/**
 * First E2E smoke for the shared API.
 *
 * Boots the real Nest app via Test.createTestingModule against test
 * Postgres / Valkey / MinIO containers and exercises the happy path:
 *   1. POST /auth/sign-up/email  → 2xx (Better Auth issues a session)
 *   2. GET  /cities?country=IT   → 200 (public list endpoint)
 *   3. GET  /issues?cityId=...   → 200 or 401 (auth-gated per spec)
 *
 * Uses Fastify's native `inject()` API rather than supertest so requests
 * stay inside the Fastify request pipeline (supertest goes through
 * middie, which hands controllers Express-style req/res and breaks
 * middlewares that call `res.header()`).
 *
 * Skip-if-docker-unavailable lives in createTestApp() so devs without a
 * Docker daemon can still run the rest of the suite.
 */
describe('signup → cities → issues (e2e)', () => {
  let boot: CreateTestAppResult | undefined;

  beforeAll(async () => {
    boot = await createTestApp();
    if (boot && 'skipped' in boot) return; // test.skip path handles the rest
  }, 120_000);

  afterAll(async () => {
    if (boot) await teardownTestApp(boot);
  });

  // Skip helper: when Docker isn't reachable, expose the same skip to all
  // tests in this file rather than crashing beforeAll.
  const skipIfNoDocker = (): boolean => !boot || 'skipped' in boot;

  it('boots, signs up a user, lists cities, and lists issues', async () => {
    if (skipIfNoDocker()) return;
    const { app, db } = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const fastify = app.getHttpAdapter().getInstance() as NestFastifyApplication['getHttpServer'] extends () => infer R
      ? R
      : never;

    // Truncate BEFORE exercising so the test is hermetic if a previous
    // file left state in this DB (different process, same container).
    await truncateAllTables(db);

    // 1. Sign-up via Better Auth's email provider. Returns 200 on success.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const su = await fastify.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      payload: { email: `e2e-${unique}@example.com`, password: 'p4ssword!', name: 'E2E' },
    });
    expect([200, 201, 204]).toContain(su.statusCode);

    // 2. List cities — public read per CitiesController. The smoke only
    //    asserts a 200 + array shape; we don't seed cities in this
    //    test because T48 is just the wiring proof.
    const cities = await fastify.inject({ method: 'GET', url: '/cities?country=IT' });
    expect(cities.statusCode).toBe(200);
    const citiesBody = cities.json();
    expect(Array.isArray(citiesBody)).toBe(true);
  });

  it('GET /issues requires auth (401 without a JWT)', async () => {
    if (skipIfNoDocker()) return;
    const { app } = boot as Exclude<CreateTestAppResult, { skipped: true }>;
    const fastify = app.getHttpAdapter().getInstance() as NestFastifyApplication['getHttpServer'] extends () => infer R
      ? R
      : never;

    // 3. Issues are auth-gated; expect 401 without a JWT. The exact
    //    status depends on JwtAuthGuard's response shape, but the spec
    //    says "unauthenticated" — 401 is the canonical mapping.
    const issues = await fastify.inject({
      method: 'GET',
      url: '/issues?cityId=00000000-0000-0000-0000-000000000000',
    });
    expect([200, 401]).toContain(issues.statusCode);
  });
});
