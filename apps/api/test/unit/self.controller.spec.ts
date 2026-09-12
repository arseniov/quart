import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { SelfController } from '../../src/self/self.controller.js';
import type { SelfService } from '../../src/self/self.service.js';

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};
const user = { id: 'u-1' } as unknown as AuthUser;
const req = { user, tenant } as never;

function makeService(overrides: Partial<SelfService> = {}): SelfService {
  return {
    get: vi.fn(async () => ({ id: 'u-1', displayName: 'Alice' } as never)),
    update: vi.fn(async (_b, _u, _t) => ({ id: 'u-1', displayName: 'Alice' } as never)),
    exportData: vi.fn(async () => ({ ok: true as const, status: 'queued' as const })),
    deleteMe: vi.fn(async () => ({ ok: true as const, graceDays: 30 as const })),
    ...overrides,
  } as unknown as SelfService;
}

describe('SelfController', () => {
  let svc: SelfService;

  beforeEach(() => {
    svc = makeService();
  });

  it('get delegates to service.get', async () => {
    const c = new SelfController(svc);
    const r = await c.get(req);
    expect(svc.get).toHaveBeenCalledWith(user, tenant);
    expect(r.displayName).toBe('Alice');
  });

  it('update delegates to service.update', async () => {
    const c = new SelfController(svc);
    const body = { displayName: 'Alicia' };
    const r = await c.update(body, req);
    expect(svc.update).toHaveBeenCalledWith(body, user, tenant);
    expect(r.displayName).toBe('Alice');
  });

  it('exportData delegates to service.exportData', async () => {
    const c = new SelfController(svc);
    const r = await c.exportData(req);
    expect(svc.exportData).toHaveBeenCalledWith(user, tenant);
    expect(r).toEqual({ ok: true, status: 'queued' });
  });

  it('deleteMe delegates to service.deleteMe', async () => {
    const c = new SelfController(svc);
    const r = await c.deleteMe(req);
    expect(svc.deleteMe).toHaveBeenCalledWith(user, tenant);
    expect(r).toEqual({ ok: true, graceDays: 30 });
  });
});
