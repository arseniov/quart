import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { IdeasController } from '../../src/ideas/ideas.controller.js';
import type { IdeasService } from '../../src/ideas/ideas.service.js';

const citizen = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['citizen'],
} as unknown as AuthUser;

const moderator = {
  id: 'm-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['moderator'],
} as unknown as AuthUser;

function makeReq(): unknown {
  return { id: 'req-1' };
}

function makeService(overrides: Partial<IdeasService> = {}): IdeasService {
  return {
    list: vi.fn(async () => [{ id: 'i1', cityId: 'c-1', authorUserId: 'u-1', title: 'T', body: 'B', status: 'published' as const, upvoteCount: 0 }]),
    get: vi.fn(async () => ({ id: 'i1', cityId: 'c-1', authorUserId: 'u-1', title: 'T', body: 'B', status: 'published' as const, upvoteCount: 0 })),
    create: vi.fn(async (_u, body) => ({ id: 'i-new', cityId: 'c-1', authorUserId: 'u-1', title: body.title, body: body.body, status: 'draft' as const, upvoteCount: 0 })),
    update: vi.fn(async (_u, id, body) => ({ id, cityId: 'c-1', authorUserId: 'u-1', title: body.title ?? 'T', body: body.body ?? 'B', status: 'draft' as const, upvoteCount: 0 })),
    delete: vi.fn(async () => undefined),
    vote: vi.fn(async () => ({ ideaId: 'i1', userId: 'u-1', upvoted: true })),
    unvote: vi.fn(async () => undefined),
    moderate: vi.fn(async (_u, id, action) => ({ id, status: action === 'hide' ? 'hidden' as const : 'published' as const })),
    listComments: vi.fn(async () => []),
    createComment: vi.fn(async (_u, id, body) => ({ id: 'cm-new', parentType: 'idea' as const, parentId: id, authorUserId: 'u-1', body: body.body })),
    ...overrides,
  } as unknown as IdeasService;
}

describe('IdeasController', () => {
  let svc: IdeasService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list delegates to service.list with cityId', async () => {
    const c = new IdeasController(svc);
    const r = await c.list(citizen, { cityId: 'c-1' } as never, makeReq() as never);
    expect(svc.list).toHaveBeenCalledWith(citizen, { cityId: 'c-1' });
    expect(r[0].id).toBe('i1');
  });

  it('get delegates to service.get', async () => {
    const c = new IdeasController(svc);
    const r = await c.get(citizen, 'i1', makeReq() as never);
    expect(svc.get).toHaveBeenCalledWith(citizen, 'i1');
    expect(r.id).toBe('i1');
  });

  it('create delegates to service.create with author user', async () => {
    const c = new IdeasController(svc);
    const body = { title: 'T', body: 'B' };
    const r = await c.create(citizen, body, makeReq() as never);
    expect(svc.create).toHaveBeenCalledWith(citizen, body);
    expect(r.id).toBe('i-new');
    expect(r.status).toBe('draft');
  });

  it('update delegates to service.update', async () => {
    const c = new IdeasController(svc);
    const body = { title: 'New' };
    const r = await c.update(citizen, 'i1', body, makeReq() as never);
    expect(svc.update).toHaveBeenCalledWith(citizen, 'i1', body);
    expect(r.id).toBe('i1');
  });

  it('delete delegates to service.delete', async () => {
    const c = new IdeasController(svc);
    await c.delete(citizen, 'i1', makeReq() as never);
    expect(svc.delete).toHaveBeenCalledWith(citizen, 'i1');
  });

  it('vote toggles via service.vote', async () => {
    const c = new IdeasController(svc);
    const r = await c.vote(citizen, 'i1', makeReq() as never);
    expect(svc.vote).toHaveBeenCalledWith(citizen, 'i1');
    expect(r.upvoted).toBe(true);
  });

  it('unvote delegates to service.unvote', async () => {
    const c = new IdeasController(svc);
    await c.unvote(citizen, 'i1', makeReq() as never);
    expect(svc.unvote).toHaveBeenCalledWith(citizen, 'i1');
  });

  it('moderate delegates to service.moderate (action: publish)', async () => {
    const c = new IdeasController(svc);
    const r = await c.moderate(moderator, 'i1', { action: 'publish' }, makeReq() as never);
    expect(svc.moderate).toHaveBeenCalledWith(moderator, 'i1', { action: 'publish' });
    expect(r.status).toBe('published');
  });

  it('listComments delegates to service.listComments', async () => {
    const c = new IdeasController(svc);
    const r = await c.listComments(citizen, 'i1', makeReq() as never);
    expect(svc.listComments).toHaveBeenCalledWith(citizen, 'i1');
    expect(r).toEqual([]);
  });

  it('createComment delegates to service.createComment', async () => {
    const c = new IdeasController(svc);
    const r = await c.createComment(citizen, 'i1', { body: 'hello' }, makeReq() as never);
    expect(svc.createComment).toHaveBeenCalledWith(citizen, 'i1', { body: 'hello' });
    expect(r.parentType).toBe('idea');
  });
});