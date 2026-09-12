import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { I18nService } from '../../src/i18n/i18n.service.js';

type Row = Record<string, unknown>;

/**
 * Stub for both `db.kysely` (raw queries used by list/get) and
 * `db.runInTenantTx` (mutation routes). The chain returns queued rows
 * from `execute*`; everything else passes through.
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

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};

describe('I18nService', () => {
  let svc: I18nService;
  let audit: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    audit = { write: vi.fn() };
  });

  describe('listLocales', () => {
    it('returns sorted locale suffixes under the i18n:mobile: prefix', async () => {
      const db = {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              where: () => ({
                execute: vi.fn(async () => [
                  { key: 'i18n:mobile:en' },
                  { key: 'i18n:mobile:it' },
                  { key: 'i18n:mobile:fr' },
                ]),
              }),
            }),
          }),
        },
        runInTenantTx: vi.fn(),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      const r = await svc.listLocales();
      expect(r).toEqual(['en', 'fr', 'it']);
    });
  });

  describe('get', () => {
    it('returns the jsonb value for a known locale', async () => {
      const db = {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              where: () => ({
                executeTakeFirst: vi.fn(async () => ({ value: { hello: 'ciao' } })),
              }),
            }),
          }),
        },
        runInTenantTx: vi.fn(),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      const r = await svc.get('it');
      expect(r).toEqual({ hello: 'ciao' });
    });

    it('returns an empty object for missing locale (mobile uses bundled fallback)', async () => {
      const db = {
        kysely: {
          selectFrom: () => ({
            select: () => ({
              where: () => ({
                executeTakeFirst: vi.fn(async () => undefined),
              }),
            }),
          }),
        },
        runInTenantTx: vi.fn(),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      const r = await svc.get('xx');
      expect(r).toEqual({});
    });
  });

  describe('upsert', () => {
    it('inserts a new locale + writes audit when no existing row', async () => {
      const trx = makeTrx([]);
      const db = {
        kysely: {},
        runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      const r = await svc.upsert(user, 'it', { hello: 'ciao' });
      expect(r).toEqual({ hello: 'ciao' });
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'i18n.create', targetId: 'it' });
      expect(audit.write.mock.calls[0][0]).toBe(trx);
    });

    it('updates an existing locale + writes audit', async () => {
      const trx = makeTrx([{ key: 'i18n:mobile:it' }]);
      const db = {
        kysely: {},
        runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      await svc.upsert(user, 'it', { hello: 'salve' });
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'i18n.update' });
    });
  });

  describe('delete', () => {
    it('deletes + writes audit when row exists', async () => {
      const trx = makeTrx([{ numDeletedRows: 1n }]);
      const db = {
        kysely: {},
        runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      await svc.delete(user, 'it');
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'i18n.delete' });
    });

    it('throws NotFound when no row matches', async () => {
      const trx = makeTrx([{ numDeletedRows: 0n }]);
      const db = {
        kysely: {},
        runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
      } as unknown as DbService;
      svc = new I18nService(db, audit as unknown as AuditService);
      await expect(svc.delete(user, 'xx')).rejects.toThrow();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });

  it('runs all mutations inside runInTenantTx', async () => {
    const trx = makeTrx([{ numDeletedRows: 1n }]);
    const db = {
      kysely: {},
      runInTenantTx: vi.fn(async (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
    } as unknown as DbService;
    svc = new I18nService(db, audit as unknown as AuditService);
    await svc.delete(user, 'it');
    expect(db.runInTenantTx).toHaveBeenCalledOnce();
    const [passedCtx] = db.runInTenantTx.mock.calls[0];
    expect(passedCtx).toMatchObject({ cityId: user.cityId, userId: user.id, isSuperAdmin: false });
  });
});