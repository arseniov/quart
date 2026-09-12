import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { SavedItemsController } from '../../src/saved-items/saved-items.controller.js';
import type { SavedItemsService } from '../../src/saved-items/saved-items.service.js';

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};
const user = { id: 'u-1' } as unknown as AuthUser;
const req = { user, tenant } as never;

function makeService(overrides: Partial<SavedItemsService> = {}): SavedItemsService {
  return {
    list: vi.fn(async () => [{ id: 's1', kind: 'poll' } as never]),
    save: vi.fn(async (body) => ({ id: 's-new', kind: body.kind, targetId: body.targetId } as never)),
    remove: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SavedItemsService;
}

describe('SavedItemsController', () => {
  let svc: SavedItemsService;

  beforeEach(() => {
    svc = makeService();
  });

  it('list delegates to service.list', async () => {
    const c = new SavedItemsController(svc);
    const out = await c.list(req);
    expect(svc.list).toHaveBeenCalledWith(tenant);
    expect(out[0].id).toBe('s1');
  });

  it('save delegates to service.save and returns ok + id', async () => {
    const c = new SavedItemsController(svc);
    const body = { kind: 'issue', targetId: '00000000-0000-0000-0000-000000000001' } as const;
    const r = await c.save(body, req);
    expect(svc.save).toHaveBeenCalledWith(body, user, tenant);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('s-new');
  });

  it('remove delegates to service.remove', async () => {
    const c = new SavedItemsController(svc);
    await c.remove('s1', req);
    expect(svc.remove).toHaveBeenCalledWith('s1', user, tenant);
  });
});
