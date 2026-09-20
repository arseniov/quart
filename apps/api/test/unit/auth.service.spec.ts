import { describe, it, expect } from 'vitest';

import { AuthService } from '../../src/auth/auth.service.js';

describe('AuthService', () => {
  it('builds a Better Auth instance with the configured secret', () => {
    const svc = new AuthService(
      {
        env: {
          BETTER_AUTH_SECRET: 'a'.repeat(32),
          BETTER_AUTH_URL: 'http://localhost:3000',
        },
      } as never,
      // ponytail: adapter not exercised in this test — kysely handle can be
      // anything with the right shape.
      { kysely: {} } as never,
      // SessionService + AuditService are only consumed by the databaseHook
      // and the sign-out plugin; this test doesn't fire either, so the
      // shape-only stubs are enough for the constructor to run.
      {} as never,
      {} as never,
    );
    expect(svc.instance).toBeDefined();
    expect(svc.instance.options.secret).toHaveLength(32);
  });
});