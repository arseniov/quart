import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminIssuesService } from '../../src/admin-issues/admin-issues.service.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';

type Row = Record<string, unknown>;

/**
 * Chainable Kysely proxy stub. Mirrors the comments.service.spec helper:
 * queue pre-loaded rows and let `execute*` drain them in order.
 */
function makeTrx(scenarios: Row[][]) {
  const queue = [...scenarios];
  const terminal = {
    execute: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: no more queued rows');
      return next;
    }),
    executeTakeFirst: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: no more queued rows');
      return next[0];
    }),
    executeTakeFirstOrThrow: vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.length === 0) throw new Error('stub: no rows');
      return next[0];
    }),
  };
  const chain: Record<string, unknown> = new Proxy(terminal, {
    get(target, prop) {
      if (prop in target) return (target as Record<string, unknown>)[prop as string];
      return () => chain;
    },
    has(target, prop) {
      return prop in target;
    },
  });
  return { trx: chain, queue };
}

function makeDb(scenarios: Row[][]) {
  const stub = makeTrx(scenarios);
  const db = {
    runInTenantTx: vi.fn(async (_ctx: TenantContext, fn: (t: unknown) => Promise<unknown>) => fn(stub.trx)),
  } as unknown as DbService;
  return { db, ...stub };
}

const tenant: TenantContext = {
  cityId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  isSuperAdmin: false,
  requestId: 'req-1',
};

describe('AdminIssuesService', () => {
  let svc: AdminIssuesService;
  let audit: { write: ReturnType<typeof vi.fn> };
  const writeSpy = vi.fn();

  beforeEach(() => {
    writeSpy.mockReset();
    audit = { write: writeSpy };
  });

  describe('list', () => {
    it('returns city-scoped issues with pagination', async () => {
      const rows = [
        { id: 'i1', status: 'open', city_id: tenant.cityId },
        { id: 'i2', status: 'open', city_id: tenant.cityId },
      ];
      const { db } = makeDb([rows]);
      svc = new AdminIssuesService(db, audit);
      const out = await svc.list({ cityId: tenant.cityId, page: 1, limit: 20 });
      expect(out).toHaveLength(2);
      expect(db.runInTenantTx).toHaveBeenCalledOnce();
    });
  });

  describe('map', () => {
    it('returns GeoJSON FeatureCollection with [lon,lat] coordinates', async () => {
      // The service extracts lon/lat via ST_X/ST_Y; the stub returns a row
      // already containing `location: { type: 'Point', coordinates: [...] }`
      // because the chained expression builder resolves to a single row.
      const rows = [
        { id: 'i1', status: 'open', location: { type: 'Point', coordinates: [12.5, 41.9] } },
      ];
      const { db } = makeDb([rows]);
      svc = new AdminIssuesService(db, audit);
      const fc = await svc.map({ cityId: tenant.cityId });
      expect(fc.type).toBe('FeatureCollection');
      expect(fc.features).toHaveLength(1);
      const feature = fc.features[0]!;
      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('Point');
      expect(feature.geometry.coordinates).toEqual([12.5, 41.9]);
      expect(feature.properties).toMatchObject({ id: 'i1', status: 'open' });
    });
  });

  describe('export', () => {
    it('returns a CSV string with the issue columns as headers', async () => {
      const rows = [
        {
          id: 'i1',
          status: 'open',
          category_id: 'cat-1',
          neighborhood_id: 'nb-1',
          author_user_id: 'u-1',
          assigned_officer_id: null,
          title: { it: 'buca' },
          description: { it: 'descrizione' },
          address_hint: 'Via Test',
          created_at: new Date('2026-01-01T00:00:00Z'),
          status_changed_at: new Date('2026-01-02T00:00:00Z'),
        },
      ];
      const { db } = makeDb([rows]);
      svc = new AdminIssuesService(db, audit);
      const csv = await svc.export({ cityId: tenant.cityId });
      // Header row present.
      expect(csv).toMatch(/^id,status,category_id,/);
      // Row should contain the id and the JSON-encoded title.
      expect(csv).toContain('i1,open,cat-1,nb-1,u-1,,');
      // JSON i18n maps are CSV-encoded and quoted because of the curly braces.
      expect(csv).toContain('"{""it"":""buca""}"');
      // Plain address with no comma/quote is emitted unquoted (RFC 4180).
      expect(csv).toContain(',Via Test,2026-');
    });
  });

  describe('bulkChangeStatus', () => {
    it('updates each issue, writes an event + audit per row in one tx', async () => {
      // The service consumes exactly 4 trx calls across the loop:
      //   updateTakeFirst(i1) → event insert(i1) → updateTakeFirst(i2) → event insert(i2)
      // audit.write is spied and does not touch the trx queue.
      const r1 = { id: 'i1', city_id: tenant.cityId, status: 'acknowledged' };
      const r2 = { id: 'i2', city_id: tenant.cityId, status: 'acknowledged' };
      const { db } = makeDb([[r1], [], [r2], []]);
      writeSpy.mockResolvedValue(undefined);
      svc = new AdminIssuesService(db, audit);

      const out = await svc.bulkChangeStatus(
        { ids: ['i1', 'i2'], status: 'acknowledged', note: 'ok' },
        { id: tenant.userId } as never,
        tenant,
      );

      expect(out).toEqual({ updated: 2 });
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy.mock.calls[0]?.[1]).toMatchObject({
        action: 'issue.status',
        targetId: 'i1',
        targetType: 'issue',
      });
      expect(writeSpy.mock.calls[1]?.[1]).toMatchObject({
        action: 'issue.status',
        targetId: 'i2',
      });
    });
  });

  describe('bulkAssign', () => {
    it('updates each issue, writes an event + audit per row in one tx', async () => {
      const r1 = { id: 'i1', city_id: tenant.cityId, assigned_officer_id: 'off-1' };
      const r2 = { id: 'i2', city_id: tenant.cityId, assigned_officer_id: 'off-1' };
      const { db } = makeDb([[r1], [], [r2], []]);
      writeSpy.mockResolvedValue(undefined);
      svc = new AdminIssuesService(db, audit);

      const out = await svc.bulkAssign(
        { ids: ['i1', 'i2'], userId: 'off-1' },
        { id: tenant.userId } as never,
        tenant,
      );

      expect(out).toEqual({ updated: 2 });
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(writeSpy.mock.calls[0]?.[1]).toMatchObject({
        action: 'issue.assign',
        targetId: 'i1',
        payload: { assigneeId: 'off-1' },
      });
    });
  });
});
