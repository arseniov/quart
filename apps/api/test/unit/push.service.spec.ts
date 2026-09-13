import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PushService } from '../../src/queue/push.service.js';
import type * as _WorkerModule from '../../src/queue/push.worker.js';

// ponytail: a single fake `db` covers both the "no terminal errors" path (no
// updates fired) and the "terminal error" path (one update per receipt that
// returned DeviceNotRegistered / InvalidCredentials / etc.).
function makeDb() {
  const updates: Array<{ table: string; where: Array<[string, unknown, unknown]>; payload: unknown }> = [];
  return {
    updates,
    kysely: {
      updateTable: (table: string) => ({
        set: (payload: unknown) => {
          const where: Array<[string, unknown, unknown]> = [];
          const chain = {
            where(col: string, op: string, val: unknown) {
              where.push([col, op, val]);
              return chain;
            },
            execute: vi.fn(async () => {
              updates.push({ table, where, payload });
              return [];
            }),
          };
          return chain;
        },
      }),
    },
  };
}

// Hoist so queue.module.ts sees the stubbed startPushWorker (otherwise the
// real factory would `new Worker(...)` and race against Valkey on import).
const workerStub: { close: ReturnType<typeof vi.fn> } = {
  close: vi.fn(async () => undefined),
};
vi.mock('../../src/queue/push.worker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof _WorkerModule>();
  return { ...actual, startPushWorker: vi.fn(() => workerStub) };
});

const ENV = { EXPO_ACCESS_TOKEN: 't', EXPO_TIMEOUT_MS: 10_000 };

function makeFetch(receipts: Array<Record<string, unknown>>, httpStatus = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ data: receipts }), { status: httpStatus }),
  );
}

const basePayload = {
  to: 'ExponentPushToken[xxx]',
  title: 'hi',
  body: 'there',
};

describe('PushService.send', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    fetchMock = makeFetch([{ status: 'ok' }]);
    db = makeDb();
    workerStub.close.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs the Expo push payload to the Expo API with bearer auth and timeout', async () => {
    const svc = new PushService({ env: ENV } as never, db as never, fetchMock as never);
    await svc.send(basePayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer t',
      },
      body: JSON.stringify(basePayload),
    });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('marks the subscription invalid when Expo returns DeviceNotRegistered', async () => {
    fetchMock = makeFetch([
      { status: 'error', message: 'DeviceNotRegistered', details: { error: 'NotRegistered' } },
    ]);
    const svc = new PushService({ env: ENV } as never, db as never, fetchMock as never);
    // Terminal errors are dropped (not thrown) — the subscription is gone, no point retrying.
    await expect(svc.send({ ...basePayload, push_subscription_id: 'sub-1' })).resolves.toBeUndefined();
    expect(db.updates).toEqual([
      {
        table: 'push_subscriptions',
        where: [['id', 'in', ['sub-1']]],
        payload: expect.objectContaining({ status: 'invalid', invalidated_at: expect.any(Date) }),
      },
    ]);
  });

  it('drops MessageTooBig receipts without retrying', async () => {
    fetchMock = makeFetch([
      { status: 'error', message: 'MessageTooBig' },
    ]);
    const svc = new PushService({ env: ENV } as never, db as never, fetchMock as never);
    await expect(svc.send({ ...basePayload, push_subscription_id: 'sub-2' })).resolves.toBeUndefined();
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.where).toEqual([['id', 'in', ['sub-2']]]);
  });

  it('throws on a transient Expo error so BullMQ retries with backoff', async () => {
    fetchMock = makeFetch([{ status: 'error', message: 'InternalServerError' }]);
    const svc = new PushService({ env: ENV } as never, db as never, fetchMock as never);
    await expect(svc.send(basePayload)).rejects.toThrow(/InternalServerError/);
    // Transient errors must NOT mark the subscription invalid.
    expect(db.updates).toHaveLength(0);
  });

  it('throws when the Expo API returns a non-2xx HTTP status', async () => {
    fetchMock = makeFetch([], 503);
    const svc = new PushService({ env: ENV } as never, db as never, fetchMock as never);
    await expect(svc.send(basePayload)).rejects.toThrow(/expo push 503/);
  });
});

describe('EnvSchema — EXPO_ACCESS_TOKEN is required', () => {
  it('rejects an empty EXPO_ACCESS_TOKEN', async () => {
    const { EnvSchema } = await import('../../src/config/schema.js');
    expect(() =>
      EnvSchema.parse({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://x',
        VALKEY_URL: 'redis://x',
        MINIO_ENDPOINT: 'x',
        MINIO_ACCESS_KEY: 'k',
        MINIO_SECRET_KEY: 's',
        MINIO_BUCKET_PRIVATE: 'p',
        MINIO_BUCKET_PUBLIC: 'q',
        BETTER_AUTH_SECRET: 'a'.repeat(32),
        BETTER_AUTH_URL: 'http://localhost',
        JWT_SIGNING_KEY: 'b'.repeat(64),
        JWT_ISSUER: 'quart.app',
        AUDIT_HMAC_KEY: 'c'.repeat(64),
        TSA_URL: 'https://api.freetsa.org/tsr',
        KEK_BASE64: Buffer.alloc(32, 7).toString('base64'),
        EXPO_ACCESS_TOKEN: '',
      }),
    ).toThrow(/EXPO_ACCESS_TOKEN/);
  });
});

describe('redactionPaths — push tokens are redacted', () => {
  it('includes the *.to path so Expo push tokens never land in logs', async () => {
    const { redactionPaths } = await import('../../src/logger/pino.config.js');
    expect(redactionPaths).toContain('*.to');
  });
});
