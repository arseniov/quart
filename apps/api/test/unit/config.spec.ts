import { describe, it, expect } from 'vitest';

import { EnvSchema } from '../../src/config/schema.js';

describe('EnvSchema', () => {
  it('parses a valid development env', () => {
    const env = EnvSchema.parse({
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgres://quart:quart@127.0.0.1:6432/quart',
      VALKEY_URL: 'redis://127.0.0.1:6379',
      MINIO_ENDPOINT: '127.0.0.1',
      MINIO_ACCESS_KEY: 'k',
      MINIO_SECRET_KEY: 's',
      MINIO_BUCKET_PRIVATE: 'quart-private',
      MINIO_BUCKET_PUBLIC: 'quart-public',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_URL: 'http://localhost:3000',
      JWT_SIGNING_KEY: 'b'.repeat(32),
      JWT_ISSUER: 'quart.app',
      AUDIT_HMAC_KEY: 'c'.repeat(64),
      SENTRY_DSN: '',
      QUART_ALLOW_FREE_TSA: 'false',
      TSA_URL: 'https://api.freetsa.org/tsr',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() =>
      EnvSchema.parse({
        NODE_ENV: 'test',
        DATABASE_URL: '',
        VALKEY_URL: 'redis://127.0.0.1:6379',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'http://localhost:3000',
        JWT_SIGNING_KEY: 'b'.repeat(32),
        AUDIT_HMAC_KEY: 'c'.repeat(64),
      }),
    ).toThrow();
  });
});