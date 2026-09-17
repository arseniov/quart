import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { SearchController } from '../../src/search/search.controller.js';
import type { SearchService } from '../../src/search/search.service.js';

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['citizen'],
} as unknown as AuthUser;

function makeService(overrides: Partial<SearchService> = {}): SearchService {
  return {
    search: vi.fn(async () => [{ id: 'iss-1', kind: 'issue', cityId: 'c-1', rank: 0.7, title: 'buca' }]),
    ...overrides,
  } as unknown as SearchService;
}

describe('SearchController', () => {
  let svc: SearchService;

  beforeEach(() => {
    svc = makeService();
  });

  it('search passes user + validated query to service', async () => {
    const c = new SearchController(svc);
    const r = await c.search(user, { q: 'buca', kind: 'issue', page: 1, limit: 20 } as never);
    expect(svc.search).toHaveBeenCalledWith(user, { q: 'buca', kind: 'issue', page: 1, limit: 20 });
    expect(r[0].id).toBe('iss-1');
  });

  it('search works with default kind (no kind specified)', async () => {
    const c = new SearchController(svc);
    await c.search(user, { q: 'buca', page: 1, limit: 20 } as never);
    expect(svc.search).toHaveBeenCalledOnce();
  });
});