import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { SavedItemsService } from '../../src/saved-items/saved-items.service.js';

function makeQuery(value: unknown): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['selectAll'] = vi.fn(chain);
  builder['where'] = vi.fn(chain);
  builder['orderBy'] = vi.fn(chain);
  builder['values'] = vi.fn(chain);
  builder['returning'] = vi.fn(chain);
  builder['returningAll'] = vi.fn(chain);
  builder['execute'] = vi.fn(async () => value);
  builder['executeTakeFirstOrThrow'] = vi.fn(async () => value);
  return builder;
}

// Proxy: any unrecognised chain method returns the same builder, so callers
// can chain `.where().where()` or `.where().execute()` interchangeably.
function makeTrx(opts: { rows?: unknown[]; insertRow?: unknown } = {}): Record<string, unknown> {
  const { rows = [], insertRow = { id: 's-new' } } = opts;
  const terminal = new Proxy(makeQuery(rows), {
    get(t, prop) {
      if (prop in t) return (t as Record<string, unknown>)[prop as string];
      return vi.fn(() => terminal);
    },
  });
  const tx: Record<string, unknown> = {
    selectFrom: vi.fn(() => terminal),
    insertInto: vi.fn(() => new Proxy(makeQuery(insertRow), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => terminal);
      },
    })),
    deleteFrom: vi.fn(() => terminal),
  };
  return tx;
}

function makeDb(trx: Record<string, unknown>): DbService {
  return {
    runInTenantTx: vi.fn(async (_ctx, fn) => fn(trx as never)),
  } as unknown as DbService;
}

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};

const user = { id: 'u-1' } as unknown as AuthUser;

describe('SavedItemsService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('list returns saved items for the user', async () => {
    const rows = [
      {
        id: 's1',
        city_id: 'c-1',
        user_id: 'u-1',
        kind: 'poll',
        target_id: '00000000-0000-0000-0000-000000000001',
        created_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const trx = makeTrx({ rows });
    const svc = new SavedItemsService(makeDb(trx), audit);

    const out = await svc.list(tenant);
    expect(out[0].id).toBe('s1');
    expect(out[0].kind).toBe('poll');
  });

  it('save inserts the row and writes an audit event in the same tx', async () => {
    const insertRow = {
      id: 's-new',
      city_id: 'c-1',
      user_id: 'u-1',
      kind: 'idea',
      target_id: '00000000-0000-0000-0000-000000000002',
      created_at: new Date(),
    };
    const trx = makeTrx({ insertRow });
    const svc = new SavedItemsService(makeDb(trx), audit);

    const out = await svc.save(
      { kind: 'idea', targetId: '00000000-0000-0000-0000-000000000002' },
      user,
      tenant,
    );
    expect(out.id).toBe('s-new');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('saved_item.create');
    expect(ev.payload.target_id).toBe('00000000-0000-0000-0000-000000000002');
  });

  it('remove deletes the row and writes an audit event in the same tx', async () => {
    const trx = makeTrx();
    const svc = new SavedItemsService(makeDb(trx), audit);

    await svc.remove('s1', user, tenant);
    expect((trx.deleteFrom as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('saved_items');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('saved_item.delete');
    expect(ev.targetId).toBe('s1');
  });
});
