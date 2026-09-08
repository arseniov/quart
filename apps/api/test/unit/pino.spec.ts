import { describe, it, expect } from 'vitest';

import { redactionPaths } from '../../src/logger/pino.config.js';

describe('redactionPaths', () => {
  it('covers the required auth-secret and PII redaction paths', () => {
    const blob = JSON.stringify([...redactionPaths]).toLowerCase();
    for (const field of [
      // auth-secret
      'password',
      'token',
      'secret',
      // PII
      'email',
      'phone',
      'location',
      'ip',
      'lat',
      'lng',
      'address',
      'user_agent',
    ]) {
      expect(blob).toContain(field);
    }
  });
});
