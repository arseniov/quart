import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { TopicsController } from '../../src/topics/topics.controller.js';
import type { TopicsService } from '../../src/topics/topics.service.js';

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
} as unknown as AuthUser;

function makeReq(): unknown {
  return { id: 'req-1', user };
}

function makeService(overrides: Partial<TopicsService> = {}): TopicsService {
  return {
    list: vi.fn(async () => [{ id: 't1', categoryId: 'cat-1', code: 'roads', nameI18n: { it: 'Strade' }, status: 'active' }]),
    get: vi.fn(async (uid, id) => ({ id, categoryId: 'cat-1', code: 'roads', nameI18n: { it: 'Strade' }, status: 'active' })),
    create: vi.fn(async (uid, body) => ({ id: 't-new', ...body, status: 'active' as const })),
    update: vi.fn(async (uid, id, body) => ({ id, ...body, status: 'active' as const })),
    delete: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TopicsService;
}

describe('TopicsController', () => {
  let svc: TopicsService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list passes the current user + cityId query', async () => {
    const c = new TopicsController(svc);
    const r = await c.list(user, { cityId: 'c-1' } as never, makeReq() as never);
    expect(svc.list).toHaveBeenCalledWith(user, { cityId: 'c-1' });
    expect(r[0].code).toBe('roads');
  });

  it('getById delegates to service.get', async () => {
    const c = new TopicsController(svc);
    const r = await c.getById(user, 't1', makeReq() as never);
    expect(svc.get).toHaveBeenCalledWith(user, 't1');
    expect(r.id).toBe('t1');
  });

  it('create delegates to service.create', async () => {
    const c = new TopicsController(svc);
    const body = { cityId: 'c-1', categoryId: 'cat-1', code: 'roads', nameI18n: { it: 'Strade' } };
    const r = await c.create(user, body, makeReq() as never);
    expect(svc.create).toHaveBeenCalledWith(user, body);
    expect(r.code).toBe('roads');
  });

  it('update delegates to service.update', async () => {
    const c = new TopicsController(svc);
    const body = { nameI18n: { en: 'Roads' } };
    const r = await c.update(user, 't1', body, makeReq() as never);
    expect(svc.update).toHaveBeenCalledWith(user, 't1', body);
    expect(r.id).toBe('t1');
  });

  it('delete delegates to service.delete', async () => {
    const c = new TopicsController(svc);
    await c.delete(user, 't1', makeReq() as never);
    expect(svc.delete).toHaveBeenCalledWith(user, 't1');
  });
});