import { describe, expect, it, vi } from 'vitest';

import type { DbService } from '../../src/db/db.service.js';
import { UsersService } from '../../src/users/users.service.js';

/**
 * Build a kysely stub that resolves `executeTakeFirst` for the user lookup
 * and `executeTakeFirst` (no-suffix) for each of the three count queries.
 * `take` toggles the "deleted" branch.
 */
function makeDb(opts: {
  user?: { id: string; handle: string; display_name: string; avatar_url: string | null; created_at: Date; status: 'active' | 'suspended' | 'deleted' } | null;
  ideasCount?: number;
  issuesCount?: number;
  pollsCount?: number;
}): DbService {
  const userRow = opts.user ?? null;
  const stats = {
    ideasCount: opts.ideasCount ?? 0,
    issuesCount: opts.issuesCount ?? 0,
    pollsCount: opts.pollsCount ?? 0,
  };
  let callIdx = 0;
  const callOrder: string[] = [];
  const proxy: Record<string, unknown> = {};
  const fn = () => proxy;
  proxy['selectFrom'] = (t: string) => {
    callOrder.push(t);
    return proxy;
  };
  proxy['select'] = fn;
  proxy['where'] = fn;
  proxy['executeTakeFirst'] = vi.fn(async () => {
    const which = callOrder[callIdx++];
    if (which === 'users') return userRow;
    if (which === 'ideas') return { c: String(stats.ideasCount) };
    if (which === 'issues') return { c: String(stats.issuesCount) };
    if (which === 'polls') return { c: String(stats.pollsCount) };
    return null;
  });
  return { kysely: proxy } as unknown as DbService;
}

describe('UsersService.findPublicById', () => {
  it('returns the public projection for an active user with stats', async () => {
    const db = makeDb({
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        handle: 'alice',
        display_name: 'Alice',
        avatar_url: 'https://cdn.example/avatar.png',
        created_at: new Date('2026-01-15T08:00:00Z'),
        status: 'active',
      },
      ideasCount: 4,
      issuesCount: 2,
      pollsCount: 1,
    });
    const svc = new UsersService(db);
    const out = await svc.findPublicById('11111111-1111-1111-1111-111111111111');
    expect(out.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(out.handle).toBe('alice');
    expect(out.displayName).toBe('Alice');
    expect(out.avatarUrl).toBe('https://cdn.example/avatar.png');
    expect(out.joinedAt).toBe('2026-01-15T08:00:00.000Z');
    expect(out.publicStats).toEqual({ ideasCount: 4, issuesCount: 2, pollsCount: 1 });
  });

  it('throws NotFoundException when the user row does not exist', async () => {
    const db = makeDb({ user: null });
    const svc = new UsersService(db);
    await expect(svc.findPublicById('missing')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws GoneException (410) when the user is soft-deleted', async () => {
    const db = makeDb({
      user: {
        id: '22222222-2222-2222-2222-222222222222',
        handle: 'gone',
        display_name: 'Gone',
        avatar_url: null,
        created_at: new Date('2025-01-01T00:00:00Z'),
        status: 'deleted',
      },
    });
    const svc = new UsersService(db);
    await expect(svc.findPublicById('22222222-2222-2222-2222-222222222222')).rejects.toMatchObject({
      status: 410,
    });
  });

  it('does NOT expose PII columns (email, phone, password) on the returned DTO', async () => {
    const db = makeDb({
      user: {
        id: '33333333-3333-3333-3333-333333333333',
        handle: 'private',
        display_name: 'Private',
        avatar_url: null,
        created_at: new Date('2026-05-01T00:00:00Z'),
        status: 'active',
      },
    });
    const svc = new UsersService(db);
    const out = await svc.findPublicById('33333333-3333-3333-3333-333333333333');
    // Field whitelist check — anything not in this list would be a leak.
    expect(Object.keys(out).sort()).toEqual(['avatarUrl', 'displayName', 'handle', 'id', 'joinedAt', 'publicStats']);
    // The stats object itself must also be whitelisted.
    expect(Object.keys(out.publicStats).sort()).toEqual(['ideasCount', 'issuesCount', 'pollsCount']);
    // Defense in depth: even if a future refactor accidentally adds a
    // snake_case leak, the regex check catches it.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toMatch(/email|phone|password|status|deleted/i);
  });

  it('returns zero counts when the user has no authored content', async () => {
    const db = makeDb({
      user: {
        id: '44444444-4444-4444-4444-444444444444',
        handle: 'newcomer',
        display_name: 'Newcomer',
        avatar_url: null,
        created_at: new Date('2026-09-01T00:00:00Z'),
        status: 'active',
      },
    });
    const svc = new UsersService(db);
    const out = await svc.findPublicById('44444444-4444-4444-4444-444444444444');
    expect(out.publicStats).toEqual({ ideasCount: 0, issuesCount: 0, pollsCount: 0 });
  });
});
