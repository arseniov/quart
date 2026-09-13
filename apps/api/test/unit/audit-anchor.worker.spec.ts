import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditAnchorCron } from '../../src/queue/audit-anchor.cron.js';
import { runAuditAnchor } from '../../src/queue/audit-anchor.worker.js';

const ANCHOR_HASH = 'a'.repeat(64);

// ponytail: Kysely's chainable builder shape can't be expressed statically without
// the real types; the stub records the insert payload and exposes the methods runAuditAnchor touches.
function makeDb() {
  const writes: unknown[] = [];
  return {
    writes,
    kysely: {
      insertInto: () => ({
        values: (v: unknown) => ({
          execute: vi.fn(async () => {
            writes.push(v);
          }),
        }),
      }),
    },
  };
}

describe('runAuditAnchor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () => new Response(Buffer.from('tsa-bytes'), { status: 200 }),
    );
  });

  it('submits the anchor hash to TSA and stores the response', async () => {
    const db = makeDb();
    await runAuditAnchor({
      config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      db: db as never,
      fetch: fetchMock as never,
      range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://tsa.example/r');
    expect(init).toMatchObject({ method: 'POST' });

    expect(db.writes).toHaveLength(1);
    const row = db.writes[0] as Record<string, unknown>;
    expect(row.anchor_hash).toBe(ANCHOR_HASH);
    expect(row.tsa_url).toBe('https://tsa.example/r');
    expect(row.tsa_cert_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tsa_response).toBeInstanceOf(Buffer);
  });

  it('refuses free TSA when QUART_ALLOW_FREE_TSA=false', async () => {
    await expect(
      runAuditAnchor({
        config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: false } } as never,
        db: makeDb() as never,
        fetch: vi.fn() as never,
        range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
      }),
    ).rejects.toThrow(/free TSA/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the TSA returns non-2xx', async () => {
    const db = makeDb();
    await expect(
      runAuditAnchor({
        config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
        db: db as never,
        fetch: vi.fn(async () => new Response('nope', { status: 503 })) as never,
        range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
      }),
    ).rejects.toThrow(/TSA 503/);
    expect(db.writes).toHaveLength(0);
  });
});

describe('AuditAnchorCron', () => {
  let queues: { add: ReturnType<typeof vi.fn>; addRepeatable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queues = {
      add: vi.fn(async () => undefined),
      addRepeatable: vi.fn(async () => undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a daily repeatable BullMQ job at 02:00 UTC', async () => {
    const cron = new AuditAnchorCron(
      queues as never,
      { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              orderBy: () => ({
                limit: () => ({
                  execute: vi.fn(async () => []),
                }),
              }),
            }),
          }),
        },
      } as never,
    );

    await cron.onModuleInit();

    expect(queues.addRepeatable).toHaveBeenCalledTimes(1);
    const [queueName, jobName, data, opts] = queues.addRepeatable.mock.calls[0]!;
    expect(queueName).toBe('audit-anchor');
    expect(jobName).toBe('anchor');
    expect(data).toEqual({ entity_id: 'audit-anchor-daily', delivery_channel: 'tsa' });
    expect(opts).toMatchObject({
      jobId: 'audit-anchor-daily',
      repeat: { pattern: '0 2 * * *', tz: 'UTC' },
    });
  });

  it('skips enqueue when there are no audit rows', async () => {
    const cron = new AuditAnchorCron(
      queues as never,
      { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              orderBy: () => ({
                limit: () => ({
                  execute: vi.fn(async () => []),
                }),
              }),
            }),
          }),
        },
      } as never,
    );

    await cron.tick();
    expect(queues.add).not.toHaveBeenCalled();
  });
});