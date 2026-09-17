import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { NotificationsController } from '../../src/notifications/notifications.controller.js';
import type { NotificationsService } from '../../src/notifications/notifications.service.js';

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};
const req = { tenant } as never;

function makeService(overrides: Partial<NotificationsService> = {}): NotificationsService {
  return {
    list: vi.fn(async () => [{ id: 'n1', title: 'hi' } as never]),
    markRead: vi.fn(async () => undefined),
    markAllRead: vi.fn(async () => 3),
    ...overrides,
  } as unknown as NotificationsService;
}

describe('NotificationsController', () => {
  let svc: NotificationsService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list passes query and tenant', async () => {
    const c = new NotificationsController(svc);
    const out = await c.list({ page: 1, limit: 20, unread: true }, req);
    expect(svc.list).toHaveBeenCalledWith({ page: 1, limit: 20, unread: true }, tenant);
    expect(out[0].id).toBe('n1');
  });

  it('markRead returns ok', async () => {
    const c = new NotificationsController(svc);
    const r = await c.markRead('n1', req);
    expect(svc.markRead).toHaveBeenCalledWith('n1', tenant);
    expect(r).toEqual({ ok: true });
  });

  it('markAllRead returns ok + count', async () => {
    const c = new NotificationsController(svc);
    const r = await c.markAllRead(req);
    expect(svc.markAllRead).toHaveBeenCalledWith(tenant);
    expect(r).toEqual({ ok: true, count: 3 });
  });
});
