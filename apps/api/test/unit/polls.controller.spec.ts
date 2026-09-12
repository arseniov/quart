import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { PollsController } from '../../src/polls/polls.controller.js';
import type { PollsService } from '../../src/polls/polls.service.js';

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
} as unknown as AuthUser;

function makeReq(): unknown {
  return { id: 'req-1', user, ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
}

function makeService(overrides: Partial<PollsService> = {}): PollsService {
  return {
    list: vi.fn(async () => [
      { id: 'p1', cityId: 'c-1', title: 'Park?', status: 'open', opensAt: new Date(), closesAt: new Date() },
    ]),
    get: vi.fn(async (_u, id) => ({
      poll: { id, cityId: 'c-1', title: 'Park?', status: 'open' },
      options: [{ id: 'o1', pollId: id, label: 'Yes', sortOrder: 0 }],
      counts: [{ optionId: 'o1', count: 3 }],
    })),
    create: vi.fn(async (_u, body) => ({
      id: 'p-new',
      cityId: body.cityId,
      title: body.title,
      status: 'draft' as const,
      options: body.options.map((o: { label: string }, i: number) => ({ id: `o${i}`, label: o.label, sortOrder: i })),
    })),
    update: vi.fn(async (_u, id, body) => ({ id, title: body.title ?? 'x', status: 'draft' as const })),
    delete: vi.fn(async () => undefined),
    publish: vi.fn(async (_u, id) => ({ id, status: 'open' as const })),
    vote: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as PollsService;
}

describe('PollsController', () => {
  let svc: PollsService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list delegates to service.list with city filter', async () => {
    const c = new PollsController(svc);
    const r = await c.list(user, { cityId: 'c-1' } as never, makeReq() as never);
    expect(svc.list).toHaveBeenCalledWith(user, { cityId: 'c-1' });
    expect(r[0].id).toBe('p1');
  });

  it('get delegates to service.get', async () => {
    const c = new PollsController(svc);
    const r = await c.get(user, 'p1', makeReq() as never);
    expect(svc.get).toHaveBeenCalledWith(user, 'p1');
    expect(r.poll.id).toBe('p1');
    expect(r.options[0].label).toBe('Yes');
    expect(r.counts[0].count).toBe(3);
  });

  it('create delegates to service.create with body + user', async () => {
    const c = new PollsController(svc);
    const body = {
      cityId: 'c-1',
      title: 'New park?',
      opensAt: '2026-09-15T00:00:00Z',
      closesAt: '2026-09-22T00:00:00Z',
      options: [{ label: 'Yes' }, { label: 'No' }],
    };
    const r = await c.create(user, body, makeReq() as never);
    expect(svc.create).toHaveBeenCalledWith(user, body);
    expect(r.id).toBe('p-new');
    expect(r.options).toHaveLength(2);
  });

  it('update delegates to service.update', async () => {
    const c = new PollsController(svc);
    const body = { title: 'Renamed park?' };
    const r = await c.update(user, 'p1', body, makeReq() as never);
    expect(svc.update).toHaveBeenCalledWith(user, 'p1', body);
    expect(r.id).toBe('p1');
  });

  it('delete delegates to service.delete', async () => {
    const c = new PollsController(svc);
    await c.remove(user, 'p1', makeReq() as never);
    expect(svc.delete).toHaveBeenCalledWith(user, 'p1');
  });

  it('publish delegates to service.publish', async () => {
    const c = new PollsController(svc);
    const r = await c.publish(user, 'p1', makeReq() as never);
    expect(svc.publish).toHaveBeenCalledWith(user, 'p1');
    expect(r.status).toBe('open');
  });

  it('vote delegates to service.vote', async () => {
    const c = new PollsController(svc);
    await c.vote(user, 'p1', { optionId: 'o1' }, makeReq() as never);
    expect(svc.vote).toHaveBeenCalledWith(user, 'p1', { optionId: 'o1' });
  });
});
