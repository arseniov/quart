import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import { I18nController } from '../../src/i18n/i18n.controller.js';
import type { I18nService } from '../../src/i18n/i18n.service.js';

const user = {
  id: 'u-1',
  cityId: 'c-1',
  isSuperAdmin: false,
  roleSnapshot: ['quart_admin'],
} as unknown as AuthUser;

function makeService(overrides: Partial<I18nService> = {}): I18nService {
  return {
    listLocales: vi.fn(async () => ['en', 'it']),
    get: vi.fn(async (locale: string) => ({ hello: locale })),
    upsert: vi.fn(async (_u: AuthUser, _locale: string, t: Record<string, unknown>) => t),
    delete: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as I18nService;
}

describe('I18nController', () => {
  let svc: I18nService;

  beforeEach(() => {
    svc = makeService();
  });

  it('listLocales delegates to service', async () => {
    const c = new I18nController(svc);
    const r = await c.listLocales();
    expect(svc.listLocales).toHaveBeenCalledOnce();
    expect(r.locales).toEqual(['en', 'it']);
  });

  it('get returns the translations for a locale', async () => {
    const c = new I18nController(svc);
    const r = await c.get('it');
    expect(svc.get).toHaveBeenCalledWith('it');
    expect(r).toEqual({ hello: 'it' });
  });

  it('upsert delegates to service.upsert with user + locale + body', async () => {
    const c = new I18nController(svc);
    const body = { translations: { hello: 'ciao' } };
    const r = await c.upsert(user, 'it', body);
    expect(svc.upsert).toHaveBeenCalledWith(user, 'it', body.translations);
    expect(r).toEqual({ locale: 'it', translations: { hello: 'ciao' } });
  });

  it('delete delegates to service.delete', async () => {
    const c = new I18nController(svc);
    await c.delete(user, 'it');
    expect(svc.delete).toHaveBeenCalledWith(user, 'it');
  });
});