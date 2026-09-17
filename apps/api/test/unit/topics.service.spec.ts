import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import { TopicsService } from '../../src/topics/topics.service.js';

interface TrxStub {
  selectFrom: ReturnType<typeof vi.fn>;
  insertInto: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
  deleteFrom: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executeTakeFirstOrThrow: ReturnType<typeof vi.fn>;
}

function makeTrx(rows: unknown[] = []): TrxStub {
  const proxy: Record<string, unknown> = {};
  const chain = () => proxy;
  proxy['selectFrom'] = vi.fn(chain);
  proxy['insertInto'] = vi.fn(chain);
  proxy['updateTable'] = vi.fn(chain);
  proxy['deleteFrom'] = vi.fn(chain);
  proxy['innerJoin'] = vi.fn(chain);
  proxy['where'] = vi.fn(chain);
  proxy['select'] = vi.fn(chain);
  proxy['set'] = vi.fn(chain);
  proxy['values'] = vi.fn(chain);
  proxy['returning'] = vi.fn(chain);
  proxy['execute'] = vi.fn(async () => rows);
  proxy['executeTakeFirstOrThrow'] = vi.fn(async () => rows[0]);
  return proxy as unknown as TrxStub;
}

function makeDb(trx: TrxStub): DbService {
  return {
    runInTenantTx: vi.fn(async (_ctx, fn) => fn(trx as never)),
  } as unknown as DbService;
}

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
} as unknown as AuthUser;

describe('TopicsService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('list returns active topics for the city', async () => {
    const rows = [
      { id: 't1', category_id: 'cat-1', code: 'roads', name_i18n: { it: 'Strade' }, status: 'active' },
    ];
    const trx = makeTrx(rows);
    const svc = new TopicsService(makeDb(trx), audit);

    const out = await svc.list(user, { cityId: 'c-1' });
    expect(out[0].code).toBe('roads');
    expect(out[0].nameI18n).toEqual({ it: 'Strade' });
  });

  it('get returns one topic by id', async () => {
    const rows = [
      { id: 't1', category_id: 'cat-1', code: 'roads', name_i18n: { it: 'Strade' }, status: 'active' },
    ];
    const trx = makeTrx(rows);
    const svc = new TopicsService(makeDb(trx), audit);

    const out = await svc.get(user, 't1');
    expect(out.id).toBe('t1');
    expect(trx.executeTakeFirstOrThrow).toHaveBeenCalled();
  });

  it('create persists the topic and writes an audit event in the same tx', async () => {
    const trx = makeTrx([{ id: 'new-id', category_id: 'cat-1', code: 'roads', name_i18n: { it: 'Strade' }, status: 'active' }]);
    const svc = new TopicsService(makeDb(trx), audit);

    const out = await svc.create(user, {
      cityId: 'c-1',
      categoryId: 'cat-1',
      code: 'roads',
      nameI18n: { it: 'Strade' },
    });

    expect(out.code).toBe('roads');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('topic.create');
    expect(ev.targetType).toBe('topic');
  });

  it('update persists changes and writes an audit event in the same tx', async () => {
    const trx = makeTrx([{ id: 't1', category_id: 'cat-1', code: 'roads', name_i18n: { en: 'Roads' }, status: 'active' }]);
    const svc = new TopicsService(makeDb(trx), audit);

    const out = await svc.update(user, 't1', { nameI18n: { en: 'Roads' } });
    expect(out.nameI18n).toEqual({ en: 'Roads' });
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('topic.update');
    expect(ev.targetId).toBe('t1');
  });

  it('delete removes the topic and writes an audit event in the same tx', async () => {
    const trx = makeTrx([{ id: 't1' }]);
    const svc = new TopicsService(makeDb(trx), audit);

    await svc.delete(user, 't1');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('topic.delete');
    expect(ev.targetId).toBe('t1');
  });
});