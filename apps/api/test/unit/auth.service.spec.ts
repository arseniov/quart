import { describe, it, expect } from 'vitest';

import { AuthService } from '../../src/auth/auth.service.js';

describe('AuthService', () => {
  it('builds a Better Auth instance with the configured secret', () => {
    const svc = new AuthService({
      env: {
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'http://localhost:3000',
      },
    } as never);
    expect(svc.instance).toBeDefined();
    expect(svc.instance.options.secret).toHaveLength(32);
  });
});
