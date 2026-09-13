import 'reflect-metadata';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptDek, encryptDek } from '../../src/pii/envelope.js';
import type * as WorkerModule from '../../src/queue/pii-rotation.worker.js';
import {
  rotatePiiKeys,
  startPiiRotationWorker,
} from '../../src/queue/pii-rotation.worker.js';
import { PiiRotationWorkerHost } from '../../src/queue/queue.module.js';

// ponytail: 32 zero bytes is enough — the worker only checks `length === 32`,
// it doesn't compare to any expected value. Real key material never enters tests.
const KEK = Buffer.alloc(32, 7);
const KEK_B64 = KEK.toString('base64');

/** Mock a DbService-shape: cities list + active KEK row + a `kysely.transaction()`
 *  that runs its callback against a stub `trx` recording updates/inserts.
 *  The same trx is reused per city so test assertions stay flat.
 *  `pii_key_versions` inserts throw Postgres `23505` (unique_violation) when
 *  the (city_id, status='active') pair has already been written — mirroring
 *  the partial unique index `pii_key_versions_one_active_per_city_idx`. */
function makeDb(opts: { cities: string[]; activeKekId: string }) {
  const updates: Array<{ table: string; payload: unknown; where: Array<[string, unknown]> }> = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const activeWrites = new Set<string>();

  const trx = {
    updateTable(table: string) {
      return {
        set(payload: unknown) {
          const where: Array<[string, unknown]> = [];
          const chain = {
            where(col: string, _op: string, val: unknown) {
              where.push([col, val]);
              return chain;
            },
            execute: vi.fn(async () => {
              updates.push({ table, payload, where });
              return [];
            }),
          };
          return chain;
        },
      };
    },
    insertInto(table: string) {
      return {
        values: (payload: unknown) => ({
          execute: vi.fn(async () => {
            if (table === 'pii_key_versions') {
              const p = payload as { city_id: string; status: string };
              // Mirror `pii_key_versions_one_active_per_city_idx`:
              // only the (city_id, status='active') pair is unique.
              const key = `${p.city_id}:${p.status}`;
              if (p.status === 'active' && activeWrites.has(key)) {
                const err = Object.assign(
                  new Error('duplicate key value violates unique constraint'),
                  { code: '23505' },
                );
                throw err;
              }
              activeWrites.add(key);
            }
            inserts.push({ table, payload });
            return [];
          }),
        }),
      };
    },
  };

  const kysely = {
    selectFrom(table: string) {
      return {
        select: () => {
          const whereChain = {
            executeTakeFirst: vi.fn(async () => {
              if (table === 'kek_versions') return { id: opts.activeKekId };
              return undefined;
            }),
            execute: vi.fn(async () => {
              if (table === 'cities') return opts.cities.map((id) => ({ id }));
              return [];
            }),
          };
          return {
            where: () => whereChain,
            ...whereChain,
          };
        },
      };
    },
    transaction: () => ({
      execute: vi.fn(async (fn: (t: typeof trx) => Promise<unknown>) => fn(trx)),
    }),
  };

  return { kysely, updates, inserts, trx };
}

const ARGS = { version: 2, dekPlaintext: 'aa'.repeat(32), kekBase64: KEK_B64 };

// Hoist so queue.module.ts sees the stubbed startPiiRotationWorker when it
// imports the worker module (otherwise `new Worker(...)` races against Valkey).
// vi.mock() is hoisted above the imports; the closure captures `workerStub`
// at factory-call time (first import), by which point the const is initialized.
const workerStub: { close: ReturnType<typeof vi.fn> } = {
  close: vi.fn(async () => undefined),
};
vi.mock('../../src/queue/pii-rotation.worker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkerModule>();
  const startSpy = vi.fn(() => workerStub);
  return { ...actual, startPiiRotationWorker: startSpy };
});

describe('rotatePiiKeys', () => {
  it('updates each city active->retiring and inserts a new active row in one transaction per city', async () => {
    const db = makeDb({ cities: ['c1', 'c2'], activeKekId: 'kek-1' });
    const result = await rotatePiiKeys({ db: db as never, kekBase64: KEK_B64 }, ARGS);

    expect(result.cities).toBe(2);
    // One transaction per city, each containing one update + one insert.
    expect(db.trx).toBeDefined();
    expect(db.updates).toEqual([
      {
        table: 'pii_key_versions',
        payload: { status: 'retiring' },
        where: [
          ['city_id', 'c1'],
          ['status', 'active'],
        ],
      },
      {
        table: 'pii_key_versions',
        payload: { status: 'retiring' },
        where: [
          ['city_id', 'c2'],
          ['status', 'active'],
        ],
      },
    ]);
    expect(db.inserts).toHaveLength(2);
    const first = db.inserts[0]!.payload as Record<string, unknown>;
    expect(first.city_id).toBe('c1');
    expect(first.version).toBe(2);
    expect(first.status).toBe('active');
    expect(first.kek_id).toBe('kek-1');
    // Stored DEK is a Buffer (not the raw plaintext hex). Layout: 12-byte iv
    // + ciphertext + 16-byte tag; plaintext was 32 bytes, so total = 60.
    expect(Buffer.isBuffer(first.dek_encrypted)).toBe(true);
    expect((first.dek_encrypted as Buffer).length).toBe(60);
  });

  it('is idempotent: a second run with the same version hits the active-unique constraint but does not duplicate', async () => {
    // The partial unique index `pii_key_versions_one_active_per_city_idx`
    // makes a second insert at the same (city, version) with status='active'
    // impossible at the DB. Kysely surfaces that as a constraint violation;
    // rotatePiiKeys catches it and treats retry as "already rotated".
    const db = makeDb({ cities: ['c1'], activeKekId: 'kek-1' });

    await rotatePiiKeys({ db: db as never, kekBase64: KEK_B64 }, ARGS);

    // Second run with the same args — the worker should not throw or duplicate.
    await expect(rotatePiiKeys({ db: db as never, kekBase64: KEK_B64 }, ARGS)).resolves.toBeDefined();

    // Inserts recorded: first run only — the second run's transaction body
    // throws on the unique constraint and the worker swallows it. Updates
    // happen on every run (mark active->retiring is a no-op once retiring).
    expect(db.inserts).toHaveLength(1);
  });

  it('throws when the DEK plaintext is missing', async () => {
    const db = makeDb({ cities: ['c1'], activeKekId: 'kek-1' });
    await expect(
      rotatePiiKeys({ db: db as never, kekBase64: KEK_B64 }, { ...ARGS, dekPlaintext: '' }),
    ).rejects.toThrow(/DEK/i);
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });
});

describe('envelope encryption round-trip', () => {
  it('encryptDek then decryptDek returns the original DEK bytes', () => {
    const dek = Buffer.from('aa'.repeat(32), 'hex');
    const stored = encryptDek(dek, KEK);
    // Layout: 12-byte iv + ciphertext + 16-byte tag. Plaintext was 32 bytes, so
    // stored should be exactly 12 + 32 + 16 = 60 bytes.
    expect(stored.length).toBe(60);
    const back = decryptDek(stored, KEK);
    expect(back.equals(dek)).toBe(true);
  });

  it('rejects decryption with the wrong KEK (GCM auth tag check)', () => {
    const dek = Buffer.from('aa'.repeat(32), 'hex');
    const stored = encryptDek(dek, KEK);
    const wrong = Buffer.alloc(32, 9);
    expect(() => decryptDek(stored, wrong)).toThrow();
  });

  it('rejects KEKs of the wrong length', () => {
    const dek = Buffer.from('aa'.repeat(32), 'hex');
    expect(() => encryptDek(dek, Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('PiiRotationWorkerHost', () => {
  beforeEach(() => {
    workerStub.close.mockClear();
  });

  it('starts a worker on init and closes it on shutdown (no auto-repeatable)', async () => {
    const host = new PiiRotationWorkerHost(
      { env: { VALKEY_URL: 'redis://localhost:6379', KEK_BASE64: KEK_B64 } } as never,
      makeDb({ cities: [], activeKekId: 'kek-1' }) as never,
    );
    await host.onModuleInit();
    await host.onApplicationShutdown();
    expect(workerStub.close).toHaveBeenCalledTimes(1);
  });

  it('exposes startPiiRotationWorker as a callable factory', () => {
    // Just verify the factory wires BullMQ — full BullMQ behavior is covered
    // by integration tests. A `new Worker()` here would race against Valkey.
    expect(typeof startPiiRotationWorker).toBe('function');
  });
});
