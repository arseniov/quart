import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import { SearchService } from '../../src/search/search.service.js';

type Row = Record<string, unknown>;

/**
 * Tiny Kysely chain stub: every terminal method returns the next row from
 * a queue; non-terminal methods return the same chain. The queue head
 * advances once per terminal call.
 */
function makeTrx(rows: Row[]) {
  const cursor = 0;
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'execute') return () => Promise.resolve(rows);
        if (prop === 'executeTakeFirst') return () => Promise.resolve(rows[cursor] ?? undefined);
        if (prop === 'executeTakeFirstOrThrow') {
          return () => {
            if (!rows[cursor]) throw new Error('stub: no row');
            return Promise.resolve(rows[cursor]);
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
} as unknown as AuthUser;

describe('SearchService', () => {
  let svc: SearchService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs in tenant tx + routes to issues tsvector path', async () => {
    const trx = makeTrx([{ id: 'iss-1', city_id: 'c-1', title: 'buca', created_at: new Date(), rank: 0.7 }]);
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    const r = await svc.search(user, { q: 'buca', kind: 'issue', page: 1, limit: 20 } as never);

    expect(db.runInTenantTx).toHaveBeenCalledOnce();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'iss-1', kind: 'issue', rank: 0.7, title: 'buca' });
  });

  it('routes poll kind to ILIKE fallback (no tsvector)', async () => {
    const trx = makeTrx([{ id: 'p-1', city_id: 'c-1', title: 'Park?', created_at: new Date() }]);
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    const r = await svc.search(user, { q: 'park', kind: 'poll', page: 1, limit: 20 } as never);

    expect(r[0]).toMatchObject({ id: 'p-1', kind: 'poll', rank: null });
  });

  it('defaults to issue kind when kind is omitted', async () => {
    const trx = makeTrx([{ id: 'iss-2', city_id: 'c-1', title: 't', created_at: new Date(), rank: 0.1 }]);
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    const r = await svc.search(user, { q: 'x', page: 1, limit: 20 } as never);

    expect(r[0].kind).toBe('issue');
  });
});