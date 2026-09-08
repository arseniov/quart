import { describe, it, expect } from 'vitest';

import { redactionPaths } from '../../src/logger/pino.config.js';

describe('redactionPaths', () => {
  it('covers the required security-sensitive paths', () => {
    const required = [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      '*.password',
      '*.token',
      '*.secret',
      '*.hmac_key',
      '*.signing_key',
      '*.better_auth_secret',
    ];
    expect([...redactionPaths]).toEqual(expect.arrayContaining(required));
  });
});
