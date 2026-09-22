// apps/api/test/integration/ba-session-mint.spec.ts
// GH #49: integration test for ba-session-mint.ts. Boots a real BA
// instance (in-memory Kysely handle against the integration DB), signs
// up a user, mints a session the same way the phone-OTP verify handler
// does (internalAdapter.createSession + serializeSessionCookie), and
// roundtrips the resulting Set-Cookie back into BA's getSession.
//
// This is the smoke fence documented in ba-session-mint.ts:any BA 1.0.x
// patch that silently changes $context.internalAdapter.createSession /
// findUserByEmail return shapes, or the cookie signing format BA's
// getSessionCookie verifies against, will trip this test on the next
// CI run. That makes the upgrade to BA 1.1+ a deliberate decision
// instead of a silent break.
//
// Excluded from `pnpm test` (unit-only) via vitest.config.ts. Run with:
//   pnpm --filter @quart/api run test:integration
// Requires TEST_DATABASE_URL (testcontainers spin-up in CI sets it).

import { fileURLToPath } from 'node:url';

import { createDb, SqlFileMigrationProvider } from '@quart/db';
import { Migrator, sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../../src/auth/auth.service.js';
import { mintBaSessionCookie } from '../../src/auth/ba-session-mint.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../infrastructure/postgres/migrations', import.meta.url),
);

let connectionUri: string;
let bootstrap: Kysely<unknown>;

describe('ba-session-mint (integration) — GH #49 upgrade contract', () => {
  beforeAll(async () => {
    connectionUri = process.env.TEST_DATABASE_URL ?? '';
    if (!connectionUri) throw new Error('TEST_DATABASE_URL not set');

    bootstrap = createDb({ connectionString: connectionUri });
    await sql`SELECT 1`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(bootstrap);
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(bootstrap);

    const migrator = new Migrator({
      db: bootstrap,
      provider: new SqlFileMigrationProvider(MIGRATIONS_DIR),
    });
    await migrator.migrateToLatest();
  }, 180_000);

  afterAll(async () => {
    // Explicit teardown so the bootstrap handle doesn't rely on
    // fork-pool teardown — safer when CI swaps pool strategy.
    await bootstrap.destroy();
  });

  it('mints a cookie that auth.instance.api.getSession accepts', async () => {
    const email = `mint-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`;

    const svc = new AuthService(
      {
        env: {
          BETTER_AUTH_SECRET: 'a'.repeat(32),
          BETTER_AUTH_URL: 'http://localhost:3000',
        },
      } as never,
      { kysely: createDb({ connectionString: connectionUri }) } as never,
      // ponytail: sessionService + auditService are only consulted by
      // baDatabaseHooks.session.create.after + baSignOutAuditPlugin's
      // hook — the BA user we mint here has no matching Quart `users`
      // row, so the session.create.after hook short-circuits at step 4
      // (missing Quart projection) before reaching `sessions.createSession`.
      // Matches auth.adapter.spec.ts's wiring.
      undefined as never,
      undefined as never,
    );

    // 1. Create the BA `user` row. emailAndPassword.autoSignIn defaults
    //    to false in BA, so signUpEmail does NOT mint a session here —
    //    the session comes exclusively from the mint below.
    const signUp = await svc.instance.api.signUpEmail({
      body: { email, password: 'password123', name: 'Mint' },
    });
    expect(signUp).toBeDefined();

    // 2. Mint via the phone-OTP-style path (internalAdapter.createSession
    //    + serializeSessionCookie). Same code the phone-OTP verify
    //    handler runs after a successful Twilio match.
    const setCookie = await mintBaSessionCookie(
      svc,
      email,
      { headers: new Headers() },
    );
    expect(setCookie).toBeTruthy();
    // GH #49 contract: cookie format mirrors BA's setSessionCookie output.
    expect(setCookie).toMatch(/^better-auth\.session_token=/);

    // 3. Forward the cookie back to BA's getSession. The substring
    //    before the first `;` is `name=value`, exactly the shape a
    //    Cookie header carries. BA's getSession runs the same
    //    getSessionCookie → signature verify → session table lookup
    //    path its own /sign-in/* endpoints run on every authed request.
    const nameValue = setCookie!.split(';', 1)[0]!;
    const verified = await svc.instance.api.getSession({
      headers: new Headers({ Cookie: nameValue }),
    });

    // GH #49 contract: getSession resolves to a Session+User pair whose
    // user.email roundtrips the input. If this fails after a BA
    // upgrade, the cookie signing format or the internal adapter
    // surface has drifted — see ba-session-mint.ts header for the
    // expected shapes.
    expect(verified).not.toBeNull();
    expect(verified?.user?.email).toBe(email);
  });

  it('returns null when no BA user row exists for the email (orphan Quart user)', async () => {
    const svc = new AuthService(
      {
        env: {
          BETTER_AUTH_SECRET: 'a'.repeat(32),
          BETTER_AUTH_URL: 'http://localhost:3000',
        },
      } as never,
      { kysely: createDb({ connectionString: connectionUri }) } as never,
      undefined as never,
      undefined as never,
    );

    // No sign-up — findUserByEmail returns null → mintBaSessionCookie
    // returns null. Same path the mobile fallback (`auth.no_session`)
    // takes for an orphan Quart user.
    const setCookie = await mintBaSessionCookie(
      svc,
      `orphan-${Date.now()}-${Math.random().toString(36).slice(2)}-${process.pid}@example.com`,
      { headers: new Headers() },
    );
    expect(setCookie).toBeNull();
  });
});