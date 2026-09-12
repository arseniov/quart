import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import { IssuesService } from '../../src/issues/issues.service.js';

interface TrxStub {
  selectFrom: ReturnType<typeof vi.fn>;
  insertInto: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
  deleteFrom: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  executeTakeFirst: ReturnType<typeof vi.fn>;
  executeTakeFirstOrThrow: ReturnType<typeof vi.fn>;
}

/**
 * Ponytail: Kysely's fluent API can't be typed without the real DSL, so the
 * stub returns itself for every chaining method. Each test sets the exact
 * `execute*` outcomes it needs (sequence-driven) instead of relying on a
 * default `rows` array.
 */
function makeTrx(): TrxStub {
  const proxy: Record<string, unknown> = {};
  const chain = () => proxy;
  proxy['selectFrom'] = vi.fn(chain);
  proxy['insertInto'] = vi.fn(chain);
  proxy['updateTable'] = vi.fn(chain);
  proxy['deleteFrom'] = vi.fn(chain);
  proxy['where'] = vi.fn(chain);
  proxy['select'] = vi.fn(chain);
  proxy['set'] = vi.fn(chain);
  proxy['values'] = vi.fn(chain);
  proxy['returning'] = vi.fn(chain);
  proxy['orderBy'] = vi.fn(chain);
  proxy['limit'] = vi.fn(chain);
  proxy['offset'] = vi.fn(chain);
  proxy['execute'] = vi.fn(async () => []);
  proxy['executeTakeFirst'] = vi.fn(async () => undefined);
  proxy['executeTakeFirstOrThrow'] = vi.fn(async () => {
    throw new Error('executeTakeFirstOrThrow not stubbed');
  });
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
  roleSnapshot: ['citizen'],
} as unknown as AuthUser;

describe('IssuesService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('list returns issues scoped to city', async () => {
    const row = {
      id: 'i-1',
      city_id: 'c-1',
      neighborhood_id: 'n-1',
      category_id: 'cat-1',
      author_user_id: 'u-1',
      title: { it: 'buca' },
      description: { it: 'desc' },
      address_hint: null,
      status: 'open',
      assigned_officer_id: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
    };
    const trx = makeTrx();
    trx.execute.mockResolvedValueOnce([row]);
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.list(user, { cityId: 'c-1' });
    expect(out[0].id).toBe('i-1');
    expect(out[0].cityId).toBe('c-1');
    expect(out[0].title).toEqual({ it: 'buca' });
  });

  it('get returns issue + photos + events', async () => {
    const issueRow = {
      id: 'i-1',
      city_id: 'c-1',
      neighborhood_id: 'n-1',
      category_id: null,
      author_user_id: 'u-1',
      title: 't',
      description: 'd',
      address_hint: null,
      status: 'open',
      assigned_officer_id: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
    };
    const photos = [{ id: 'p-1', issue_id: 'i-1', object_key: 'k1', sort_order: 0, created_at: new Date() }];
    const events = [{ id: 'e-1', issue_id: 'i-1', actor_user_id: 'u-1', event_type: 'created', payload: {}, created_at: new Date() }];
    const trx = makeTrx();
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce(issueRow);
    trx.execute.mockResolvedValueOnce(photos);
    trx.execute.mockResolvedValueOnce(events);
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.get(user, 'i-1');
    expect(out.issue.id).toBe('i-1');
    expect(out.photos).toHaveLength(1);
    expect(out.events).toHaveLength(1);
  });

  it('create infers neighborhood via ST_Within, writes issue + event + audit in same tx', async () => {
    const trx = makeTrx();
    // inferNeighborhood: ST_Within (executeTakeFirst) hits → no fallback
    trx.executeTakeFirst.mockResolvedValueOnce({ id: 'nb-1' });
    // insertInto('issues').returning('id').executeTakeFirstOrThrow()
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ id: 'new-id' });
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.create(user, {
      categoryId: 'cat-1',
      titleI18n: { it: 'buca' },
      descriptionI18n: { it: 'descrizione' },
      location: { type: 'Point', coordinates: [12.5, 41.9] },
      address: 'Via Test 1',
      photoKeys: [],
    });

    expect(out.id).toBe('new-id');
    expect(out.neighborhoodId).toBe('nb-1');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('issue.create');
    expect(ev.targetType).toBe('issue');
    expect(ev.targetId).toBe('new-id');
  });

  it('create falls back to ST_Distance centroid when ST_Within misses', async () => {
    const trx = makeTrx();
    // inferNeighborhood: ST_Within miss
    trx.executeTakeFirst.mockResolvedValueOnce(null);
    // inferNeighborhood: ST_Distance fallback (executeTakeFirstOrThrow)
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ id: 'nb-2' });
    // insertInto('issues').returning('id').executeTakeFirstOrThrow()
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce({ id: 'new-id' });
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.create(user, {
      categoryId: 'cat-1',
      titleI18n: { it: 'x' },
      descriptionI18n: { it: 'y' },
      location: { type: 'Point', coordinates: [0, 0] },
      photoKeys: [],
    });
    expect(out.neighborhoodId).toBe('nb-2');
    expect(out.id).toBe('new-id');
    // Both calls (ST_Within + ST_Distance) ran.
    expect(trx.executeTakeFirst).toHaveBeenCalledTimes(1);
    expect(trx.executeTakeFirstOrThrow).toHaveBeenCalledTimes(2);
  });

  it('changeStatus updates status, writes issue_events row, and audits', async () => {
    const updatedRow = {
      id: 'i-1',
      city_id: 'c-1',
      neighborhood_id: 'n-1',
      category_id: null,
      author_user_id: 'u-1',
      title: 't',
      description: 'd',
      address_hint: null,
      status: 'acknowledged',
      assigned_officer_id: null,
      created_at: new Date(),
    };
    const trx = makeTrx();
    // updateTable('issues')...returning().executeTakeFirstOrThrow()
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce(updatedRow);
    // insertInto('issue_events').values().execute() → default returns []
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.changeStatus(user, 'i-1', { status: 'acknowledged', note: 'ok' });
    expect(out.status).toBe('acknowledged');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('issue.status');
    expect(ev.targetId).toBe('i-1');
    // Issue events insert + status update both happened.
    expect(trx.execute).toHaveBeenCalledTimes(1);
    expect(trx.executeTakeFirstOrThrow).toHaveBeenCalledTimes(1);
  });

  it('assign sets officer, writes issue_events row, and audits', async () => {
    const updatedRow = {
      id: 'i-1',
      city_id: 'c-1',
      neighborhood_id: 'n-1',
      category_id: null,
      author_user_id: 'u-1',
      title: 't',
      description: 'd',
      address_hint: null,
      status: 'open',
      assigned_officer_id: 'officer-1',
      created_at: new Date(),
    };
    const trx = makeTrx();
    trx.executeTakeFirstOrThrow.mockResolvedValueOnce(updatedRow);
    const svc = new IssuesService(makeDb(trx), audit);

    const out = await svc.assign(user, 'i-1', { userId: 'officer-1' });
    expect(out.assignedOfficerId).toBe('officer-1');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('issue.assign');
    expect(ev.payload.assigneeId).toBe('officer-1');
  });
});
