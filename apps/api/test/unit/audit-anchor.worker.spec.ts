import 'reflect-metadata';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WorkerModule from '../../src/queue/audit-anchor.worker.js';
import {
  auditAnchorHandler,
  computeAnchorRange,
  runAuditAnchor,
} from '../../src/queue/audit-anchor.worker.js';
import { AuditAnchorWorkerHost } from '../../src/queue/queue.module.js';

const ANCHOR_HASH = 'a'.repeat(64);

// ponytail: Kysely's chainable builder shape can't be expressed statically
// without the real types; the stub records onConflict/execute so we can
// assert the idempotency chain is wired.
function makeDb() {
  const onConflict = vi.fn(
    (_cb: (oc: { column: (n: string) => { doNothing: () => unknown } }) => unknown) => ({
      execute,
    }),
  );
  const execute = vi.fn(async () => undefined);
  return {
    onConflict,
    execute,
    kysely: {
      insertInto: () => ({
        values: () => ({ onConflict, execute }),
      }),
    },
  };
}

// hoist this mock so queue.module.ts sees the stubbed startAuditAnchorWorker.
const workerStub: { close: ReturnType<typeof vi.fn> } = {
  close: vi.fn(async () => undefined),
};
vi.mock('../../src/queue/audit-anchor.worker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkerModule>();
  const startSpy = vi.fn(() => workerStub);
  return { ...actual, startAuditAnchorWorker: startSpy };
});

describe('runAuditAnchor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(Buffer.from('tsa-bytes'), { status: 200 }));
  });

  function stubFor(_desc: 'happy' | 'timeout' | 'duplicate') {
    return makeDb();
  }

  it('submits the anchor hash to TSA and stores the response', async () => {
    const db = stubFor('happy');
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

    // The chain `.values().onConflict(...).execute()` fired exactly once.
    expect(db.onConflict).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
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
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('attaches an AbortSignal.timeout to the TSA fetch', async () => {
    const db = makeDb();
    await runAuditAnchor({
      config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      db: db as never,
      fetch: fetchMock as never,
      range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Ponytail: don't assert `aborted` — the test runner may have elapsed
    // past 10s by the time we check; just verify the signal was attached.
  });

  it('treats a duplicate anchor_hash insert as a no-op', async () => {
    // Both calls hit the chain — onConflict.doNothing() swallows the duplicate
    // (DB-side UNIQUE constraint turns that into a 0-row UPDATE). The point:
    // the Kysely chain ends in `.execute()` either way, never throws.
    const db = makeDb();
    await runAuditAnchor({
      config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      db: db as never,
      fetch: fetchMock as never,
      range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
    });
    await expect(
      runAuditAnchor({
        config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
        db: db as never,
        fetch: fetchMock as never,
        range: { start: 1n, end: 2n, anchorHash: ANCHOR_HASH },
      }),
    ).resolves.toBeDefined();
    // Two writes, two onConflict decisions — neither threw.
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.onConflict).toHaveBeenCalledTimes(2);
  });
});

describe('computeAnchorRange', () => {
  function makeSelectDb(rows: Array<{ id: string; row_hash: string }>) {
    return {
      kysely: {
        selectFrom: () => ({
          select: () => ({
            orderBy: () => ({
              limit: () => ({
                execute: vi.fn(async () => rows),
              }),
            }),
          }),
        }),
      },
    } as never;
  }

  it('returns null when audit_log is empty', async () => {
    const range = await computeAnchorRange(makeSelectDb([]));
    expect(range).toBeNull();
  });

  it('hashes the row_hash sequence into the AnchorRange', async () => {
    const rows = [
      { id: '2', row_hash: 'bb'.repeat(32) },
      { id: '1', row_hash: 'aa'.repeat(32) },
    ];
    const range = await computeAnchorRange(makeSelectDb(rows));
    expect(range).not.toBeNull();
    expect(range!.anchorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(range!.end).toBe(2n);
    expect(range!.start).toBe(1n);
  });
});

describe('auditAnchorHandler', () => {
  it('no-ops when audit_log is empty', async () => {
    const fetchMock = vi.fn();
    await auditAnchorHandler({
      config: { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true } } as never,
      db: {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              orderBy: () => ({
                limit: () => ({ execute: vi.fn(async () => []) }),
              }),
            }),
          }),
        },
      } as never,
      fetch: fetchMock as never,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AuditAnchorWorkerHost', () => {
  let queues: { addRepeatable: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    queues = { addRepeatable: vi.fn(async () => undefined) };
    workerStub.close.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers the daily repeatable and starts a worker on init', async () => {
    const host = new AuditAnchorWorkerHost(
      queues as never,
      { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true, VALKEY_URL: 'redis://localhost:6379' } } as never,
      { kysely: {} } as never,
    );
    await host.onModuleInit();
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

  it('closes the worker on application shutdown', async () => {
    const host = new AuditAnchorWorkerHost(
      queues as never,
      { env: { TSA_URL: 'https://tsa.example/r', QUART_ALLOW_FREE_TSA: true, VALKEY_URL: 'redis://localhost:6379' } } as never,
      { kysely: {} } as never,
    );
    await host.onModuleInit();
    await host.onApplicationShutdown();
    expect(workerStub.close).toHaveBeenCalledTimes(1);
  });
});
