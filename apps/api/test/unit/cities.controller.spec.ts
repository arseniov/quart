import { describe, it, expect, vi } from 'vitest';

import { CitiesController } from '../../src/cities/cities.controller.js';
import type { DbService } from '../../src/db/db.service.js';

/**
 * Kysely chain stub. Each chained method returns the same proxy so
 * further method calls chain naturally; `execute` / `executeTakeFirstOrThrow`
 * resolve the supplied rows.
 */
function kyselyChain(rows: unknown[]): unknown {
  const stub = (): unknown => proxy;
  const proxy: Record<string, unknown> = {};
  proxy['select'] = stub;
  proxy['where'] = stub;
  proxy['selectFrom'] = stub;
  proxy['execute'] = vi.fn(async () => rows);
  proxy['executeTakeFirstOrThrow'] = vi.fn(async () => rows[0]);
  return proxy;
}

describe('CitiesController', () => {
  it('list returns active cities', async () => {
    const db = { kysely: kyselyChain([
      { id: 'c', slug: 'roma', name: 'Roma', country_code: 'IT', locale_default: 'it', timezone: 'Europe/Rome', status: 'active' },
    ]) } as unknown as DbService;
    const c = new CitiesController(db);
    const r = await c.list({ country: 'IT' } as never);
    expect(r[0].slug).toBe('roma');
    expect(r[0].countryCode).toBe('IT');
    expect(r[0].localeDefault).toBe('it');
  });

  it('getBySlug returns city + neighborhoods', async () => {
    const city = { id: 'c', slug: 'roma', name: 'Roma', country_code: 'IT', locale_default: 'it', timezone: 'Europe/Rome', status: 'active' };
    const neighborhoods = [{ id: 'n', slug: 'centro', name: 'Centro' }];
    let call = 0;
    const proxy: Record<string, unknown> = {};
    proxy['select'] = () => proxy;
    proxy['where'] = () => proxy;
    proxy['selectFrom'] = () => proxy;
    proxy['execute'] = vi.fn(async () => neighborhoods);
    proxy['executeTakeFirstOrThrow'] = vi.fn(async () => {
      call += 1;
      return call === 1 ? city : null;
    });
    const db = { kysely: proxy } as unknown as DbService;
    const c = new CitiesController(db);
    const r = await c.getBySlug('roma');
    expect(r.slug).toBe('roma');
    expect(r.neighborhoods[0].slug).toBe('centro');
  });

  it('neighborhoods lists neighborhoods for a city slug', async () => {
    const city = { id: 'c' };
    const neighborhoods = [{ id: 'n1', slug: 'centro', name: 'Centro' }];
    let call = 0;
    const proxy: Record<string, unknown> = {};
    proxy['select'] = () => proxy;
    proxy['where'] = () => proxy;
    proxy['selectFrom'] = () => proxy;
    proxy['execute'] = vi.fn(async () => {
      call += 1;
      return call === 2 ? neighborhoods : [];
    });
    proxy['executeTakeFirstOrThrow'] = vi.fn(async () => {
      call += 1;
      return call === 1 ? city : null;
    });
    const db = { kysely: proxy } as unknown as DbService;
    const c = new CitiesController(db);
    const r = await c.neighborhoods('roma');
    expect(r[0].slug).toBe('centro');
  });
});
