// GH #23 — verifies that the neighborhood_id filter routes to both the
// tsvector (issue/idea) and ILIKE (poll) paths. Mobile uses the same DTO
// fields, so this is the only place we have to gate the filter.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import { SearchService } from '../../src/search/search.service.js';

type Row = Record<string, unknown>;

/**
 * Tiny Kysely chain stub — passes the same shape as search.service.spec.ts
 * but threads `$if()` callbacks through to a real chain so the inner
 * `where('neighborhood_id', ...)` actually fires.
 */
function makeTrx(rows: Row[], capture: { sawNeighborhoodWhere: boolean }) {
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'execute') return () => Promise.resolve(rows);
        if (prop === 'executeTakeFirst') return () => Promise.resolve(rows[0] ?? undefined);
        if (prop === '$if') {
          return (cond: boolean, cb: (qb: unknown) => unknown) => {
            if (cond) cb(chain); // ponytail: only invoke the branch when Kysely would
            return chain;
          };
        }
        // where / selectFrom / etc — record the column name and return chain
        return (col?: unknown, _op?: unknown, val?: unknown) => {
          if (col === 'neighborhood_id') capture.sawNeighborhoodWhere = true;
          void val;
          return chain;
        };
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

describe('SearchService neighborhood filter (GH #23)', () => {
  let svc: SearchService;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies neighborhood filter on issue tsvector path', async () => {
    const capture = { sawNeighborhoodWhere: false };
    const trx = makeTrx(
      [{ id: 'iss-1', city_id: 'c-1', title: 'buca', created_at: new Date(), rank: 0.5 }],
      capture,
    );
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    await svc.search(
      user,
      { q: 'buca', kind: 'issue', neighborhoodId: 'n-9', page: 1, limit: 20 } as never,
    );
    expect(capture.sawNeighborhoodWhere).toBe(true);
  });

  it('applies neighborhood filter on poll ILIKE path', async () => {
    const capture = { sawNeighborhoodWhere: false };
    const trx = makeTrx(
      [{ id: 'p-1', city_id: 'c-1', title: 'Park?', created_at: new Date() }],
      capture,
    );
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    await svc.search(
      user,
      { q: 'park', kind: 'poll', neighborhoodId: 'n-9', page: 1, limit: 20 } as never,
    );
    expect(capture.sawNeighborhoodWhere).toBe(true);
  });

  it('does NOT apply neighborhood filter when omitted', async () => {
    const capture = { sawNeighborhoodWhere: false };
    const trx = makeTrx(
      [{ id: 'iss-1', city_id: 'c-1', title: 'buca', created_at: new Date(), rank: 0.5 }],
      capture,
    );
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new SearchService(db);

    await svc.search(user, { q: 'buca', kind: 'issue', page: 1, limit: 20 } as never);
    expect(capture.sawNeighborhoodWhere).toBe(false);
  });
});
