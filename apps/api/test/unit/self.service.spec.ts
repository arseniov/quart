import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { SelfService } from '../../src/self/self.service.js';

function makeQuery(value: unknown): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['select'] = vi.fn(chain);
  builder['returning'] = vi.fn(chain);
  builder['where'] = vi.fn(chain);
  builder['set'] = vi.fn(chain);
  builder['execute'] = vi.fn(async () => value);
  builder['executeTakeFirstOrThrow'] = vi.fn(async () => value);
  return builder;
}

function makeTrx(opts: { row?: unknown; updatedRow?: unknown } = {}): Record<string, unknown> {
  const defaultRow = {
    id: 'u-1',
    handle: 'alice',
    email: 'a@x',
    phone_e164: null,
    display_name: 'Alice',
    avatar_url: null,
    locale: 'it',
    default_city_id: '00000000-0000-0000-0000-000000000001',
    status: 'active',
  };
  const row = opts.row ?? defaultRow;
  const updatedRow = opts.updatedRow ?? defaultRow;
  const tx: Record<string, unknown> = {
    selectFrom: vi.fn(() => new Proxy(makeQuery(row), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => t);
      },
    })),
    updateTable: vi.fn(() => new Proxy(makeQuery(updatedRow), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => t);
      },
    })),
  };
  return tx;
}

function makeDb(trx: Record<string, unknown>): DbService {
  return {
    runInTenantTx: vi.fn(async (_ctx, fn) => fn(trx as never)),
  } as unknown as DbService;
}

const tenant: TenantContext = {
  cityId: 'c-1',
  userId: 'u-1',
  isSuperAdmin: false,
  requestId: 'req-1',
};

const user = { id: 'u-1' } as unknown as AuthUser;

describe('SelfService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('get returns the user profile mapped to camelCase', async () => {
    const trx = makeTrx();
    const svc = new SelfService(makeDb(trx), audit);

    const out = await svc.get(user, tenant);
    expect(out.displayName).toBe('Alice');
    expect(out.locale).toBe('it');
    expect(out.status).toBe('active');
  });

  it('update with empty patch returns current row without an audit event', async () => {
    const trx = makeTrx();
    const svc = new SelfService(makeDb(trx), audit);

    const out = await svc.update({}, user, tenant);
    expect(out.displayName).toBe('Alice');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('update with patch writes the row + audit event in the same tx', async () => {
    const updatedRow = {
      id: 'u-1',
      handle: 'alice',
      email: 'a@x',
      phone_e164: null,
      display_name: 'Alicia',
      avatar_url: null,
      locale: 'it',
      default_city_id: '00000000-0000-0000-0000-000000000001',
      status: 'active',
    };
    const trx = makeTrx({ updatedRow });
    const svc = new SelfService(makeDb(trx), audit);

    const out = await svc.update({ displayName: 'Alicia' }, user, tenant);
    expect(out.displayName).toBe('Alicia');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('self.update');
    expect(ev.payload.changes).toContain('display_name');
  });

  it('exportData writes an audit event and returns queued', async () => {
    const trx = makeTrx();
    const svc = new SelfService(makeDb(trx), audit);

    const out = await svc.exportData(user, tenant);
    expect(out).toEqual({ ok: true, status: 'queued' });
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('self.export');
    expect(ev.payload.kind).toBe('gdpr_export');
  });

  it('deleteMe soft-deletes the user and writes an audit event in the same tx', async () => {
    const trx = makeTrx();
    const svc = new SelfService(makeDb(trx), audit);

    const out = await svc.deleteMe(user, tenant);
    expect(out).toEqual({ ok: true, graceDays: 30 });
    expect((trx.updateTable as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('users');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('self.delete');
    expect(ev.payload.grace_days).toBe(30);
  });
});
