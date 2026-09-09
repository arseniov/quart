import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { ConfigService } from '../../src/config/config.service.js';

describe('AppModule', () => {
  it('compiles without missing provider errors', async () => {
    const stub = {
      env: {
        NODE_ENV: 'test',
        PORT: 3000,
        DATABASE_URL: 'postgres://q:q@127.0.0.1:6432/quart',
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
        SENTRY_ENVIRONMENT: 'test',
        QUART_ALLOW_FREE_TSA: false,
        TSA_URL: 'https://api.freetsa.org/tsr',
        LOG_LEVEL: 'silent',
      },
    } as unknown as ConfigService;
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(stub)
      .compile();
    expect(mod).toBeDefined();
  });
});
