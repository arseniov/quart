import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { ConfigService } from '../../src/config/config.service.js';
import { FanoutService } from '../../src/notifications/fanout.service.js';
import { EmailService } from '../../src/queue/email.service.js';
import { PushService } from '../../src/queue/push.service.js';
import { QueueService } from '../../src/queue/queue.service.js';

// ponytail: keys read by real (non-stub) providers at construction
// (SlowQueryEnvSchema, OtelEnvSchema, throttler). Set BEFORE AppModule
// is imported because @Module decorators + factory imports evaluate
// at module-load time, not at Test.createTestingModule time.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://q:q@127.0.0.1:6432/quart',
  AUDIT_HMAC_KEY: 'c'.repeat(64),
  KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
  SENTRY_DSN: '',
  OTEL_ENABLED: 'false',
  LOG_LEVEL: 'silent',
});

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
        JWT_SIGNING_KEY: 'b'.repeat(64),
        JWT_ISSUER: 'quart.app',
        AUDIT_HMAC_KEY: 'c'.repeat(64),
        SENTRY_DSN: '',
        SENTRY_ENVIRONMENT: 'test',
        QUART_ALLOW_FREE_TSA: false,
        TSA_URL: 'https://api.freetsa.org/tsr',
        LOG_LEVEL: 'silent',
        EXPO_ACCESS_TOKEN: 't',
        EXPO_TIMEOUT_MS: 10_000,
        KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
        SES_FROM_ADDRESS: '',
        // T54: magic-link endpoints construct verify URLs against this base.
        MAGIC_LINK_BASE_URL: 'https://api.quart.app',
      },
    } as unknown as ConfigService;
    const queueStub = {
      enqueue: async () => undefined,
      addRepeatable: async () => undefined,
      onApplicationShutdown: async () => undefined,
      getDepth: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 }),
    } as unknown as QueueService;
    const pushStub = { send: async () => undefined } as unknown as PushService;
    const emailStub = { send: async () => undefined } as unknown as EmailService;
    const fanoutStub = { fanout: async () => undefined } as unknown as FanoutService;
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(stub)
      .overrideProvider(QueueService)
      .useValue(queueStub)
      .overrideProvider(PushService)
      .useValue(pushStub)
      .overrideProvider(EmailService)
      .useValue(emailStub)
      .overrideProvider(FanoutService)
      .useValue(fanoutStub)
      // ponytail: .useMocker removed on 2026-09-17 after a follow-up
      // commit reverted the import-cleanup conversions of constructor
      // deps to value imports in 7 services/controllers. The mocker is
      // no longer needed for the original failure mode but remains
      // available as defensive coverage if a future import-type
      // regression slips in.
      // .useMocker(() => ({}))
      .compile();
    expect(mod).toBeDefined();
  });
});
