import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { CommentsService } from '../../src/comments/comments.service.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';

/**
 * Chainable Kysely proxy stub. Every terminal method resolves a queue of
 * pre-loaded rows. `execute()` returns the whole queue; `executeTakeFirst*`
 * returns the head. New chains reset the queue head so a single stub can
 * drive create→read→update scenarios in one test.
 */
type Row = Record<string, unknown>;

function makeTrx(scenarios: Row[][]) {
  let queue = [...scenarios];
  let current: Row[] | null = null;
  const pop = (): Row[] => {
    const next = queue.shift();
    if (!next) throw new Error('trx stub: no more queued rows');
    current = next;
    return next;
  };
  const terminal = {
    execute: vi.fn(async () => {
      const rows = pop();
      return rows;
    }),
    executeTakeFirst: vi.fn(async () => {
      const rows = pop();
      return rows[0];
    }),
    executeTakeFirstOrThrow: vi.fn(async () => {
      const rows = pop();
      if (rows.length === 0) throw new Error('stub: no rows');
      return rows[0];
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

describe('CommentsService', () => {
  let svc: CommentsService;
  let audit: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('returns visible comments for a target', async () => {
      const rows = [{ id: 'c1', body: 'hi', author_user_id: 'u1', status: 'visible' }];
      const { db } = makeDb([rows]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      const r = await svc.list({ targetType: 'issue', targetId: 'i1', limit: 20, offset: 0 }, tenant);
      expect(r[0].id).toBe('c1');
      expect(db.runInTenantTx).toHaveBeenCalledOnce();
    });
  });

  describe('get', () => {
    it('returns comment + reactions', async () => {
      const comment = { id: 'c1', body: 'hi', author_user_id: 'u1', status: 'visible' };
      const reactions = [{ reaction: 'up', user_id: 'u2' }];
      const { db } = makeDb([[comment], reactions]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      const r = await svc.get('c1', tenant);
      expect(r.id).toBe('c1');
      expect(r.reactions).toEqual(reactions);
    });

    it('throws NotFound when comment does not exist', async () => {
      const { db } = makeDb([[]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await expect(svc.get('missing', tenant)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('inserts comment + writes audit in same tx', async () => {
      const inserted = { id: 'c-new', parent_type: 'issue', parent_id: 'i1', author_user_id: 'u1' };
      const stub = makeTrx([[inserted]]);
      const db = {
        runInTenantTx: vi.fn(async (_ctx: TenantContext, fn: (t: unknown) => Promise<unknown>) => fn(stub.trx)),
      } as unknown as DbService;
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      const r = await svc.create({ targetType: 'issue', targetId: 'i1', body: 'hello' }, { id: 'u1' } as never, tenant);
      expect(r.id).toBe('c-new');
      expect(audit.write).toHaveBeenCalledOnce();
      const [passedTrx, ev] = audit.write.mock.calls[0];
      expect(ev).toMatchObject({ action: 'comment.create', targetType: 'comment', targetId: 'c-new' });
      // write() was invoked with the same trx runInTenantTx produced, so
      // the audit row joins the same transaction as the insert.
      expect(passedTrx).toBe(stub.trx);
    });
  });

  describe('update', () => {
    it('updates body when caller is author', async () => {
      const existing = { id: 'c1', author_user_id: 'u1', body: 'old' };
      const updated = { id: 'c1', author_user_id: 'u1', body: 'new' };
      const { db } = makeDb([[existing], [updated]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await svc.update('c1', { body: 'new' }, { id: 'u1', isSuperAdmin: false, roleSnapshot: [] } as never, tenant);
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'comment.update' });
    });

    it('throws Forbidden when caller is not the author', async () => {
      const existing = { id: 'c1', author_user_id: 'someone-else', body: 'old' };
      const { db } = makeDb([[existing]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await expect(
        svc.update('c1', { body: 'new' }, { id: 'u1', isSuperAdmin: false, roleSnapshot: [] } as never, tenant),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('allows moderator to edit any comment', async () => {
      const existing = { id: 'c1', author_user_id: 'someone-else', body: 'old' };
      const updated = { id: 'c1', author_user_id: 'someone-else', body: 'moderated' };
      const { db } = makeDb([[existing], [updated]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await svc.update(
        'c1',
        { body: 'moderated' },
        { id: 'u-mod', isSuperAdmin: false, roleSnapshot: ['moderator'] } as never,
        tenant,
      );
      expect(audit.write).toHaveBeenCalledOnce();
    });

    it('super-admin bypasses author check', async () => {
      const existing = { id: 'c1', author_user_id: 'someone-else', body: 'old' };
      const updated = { id: 'c1', author_user_id: 'someone-else', body: 'x' };
      const { db } = makeDb([[existing], [updated]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await svc.update(
        'c1',
        { body: 'x' },
        { id: 'u-root', isSuperAdmin: true, roleSnapshot: [] } as never,
        tenant,
      );
      expect(audit.write).toHaveBeenCalledOnce();
    });
  });

  describe('delete', () => {
    it('soft-deletes when caller is author', async () => {
      const existing = { id: 'c1', author_user_id: 'u1', status: 'visible' };
      const { db } = makeDb([[existing], []]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await svc.delete('c1', { id: 'u1', isSuperAdmin: false, roleSnapshot: [] } as never, tenant);
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'comment.delete' });
    });

    it('throws Forbidden when caller is not author and not moderator/super-admin', async () => {
      const existing = { id: 'c1', author_user_id: 'someone-else', status: 'visible' };
      const { db } = makeDb([[existing]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await expect(
        svc.delete('c1', { id: 'u-other', isSuperAdmin: false, roleSnapshot: ['citizen'] } as never, tenant),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(audit.write).not.toHaveBeenCalled();
    });

    it('super-admin bypasses author check', async () => {
      const existing = { id: 'c1', author_user_id: 'someone-else', status: 'visible' };
      const { db } = makeDb([[existing], []]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await svc.delete('c1', { id: 'u-root', isSuperAdmin: true, roleSnapshot: [] } as never, tenant);
      expect(audit.write).toHaveBeenCalledOnce();
    });
  });

  describe('react', () => {
    it('inserts reaction + writes audit when none present', async () => {
      const comment = { id: 'c1', status: 'visible' };
      // 1) lookup comment → visible; 2) lookup reaction → empty; 3) insert → ok
      const { db } = makeDb([[comment], [], []]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      const r = await svc.react('c1', { reaction: 'up' }, { id: 'u1' } as never, tenant);
      expect(r.status).toBe('added');
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'comment.react.add' });
    });

    it('removes reaction + writes audit when already present', async () => {
      const comment = { id: 'c1', status: 'visible' };
      const existing = { comment_id: 'c1', user_id: 'u1', reaction: 'up' };
      const { db } = makeDb([[comment], [existing], []]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      const r = await svc.react('c1', { reaction: 'up' }, { id: 'u1' } as never, tenant);
      expect(r.status).toBe('removed');
      expect(audit.write).toHaveBeenCalledOnce();
      expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'comment.react.remove' });
    });

    it('throws NotFound when comment is missing or deleted', async () => {
      const { db } = makeDb([[]]);
      audit = { write: vi.fn() };
      svc = new CommentsService(db, audit);
      await expect(svc.react('missing', { reaction: 'up' }, { id: 'u1' } as never, tenant)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
