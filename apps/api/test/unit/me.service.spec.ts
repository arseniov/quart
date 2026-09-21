import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { AuthUser } from '../../src/auth/decorators/current-user.decorator.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { MeService } from '../../src/me/me.service.js';

function makeQuery(value: unknown): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['selectAll'] = vi.fn(chain);
  builder['where'] = vi.fn(chain);
  builder['orderBy'] = vi.fn(chain);
  builder['values'] = vi.fn(chain);
  builder['onConflict'] = vi.fn(chain);
  builder['doUpdateSet'] = vi.fn(chain);
  builder['returning'] = vi.fn(chain);
  builder['returningAll'] = vi.fn(chain);
  builder['execute'] = vi.fn(async () => value);
  builder['executeTakeFirstOrThrow'] = vi.fn(async () => value);
  builder['columns'] = vi.fn(chain);
  return builder;
}

// Proxy: any unrecognised chain method returns the same builder, so callers
// can chain `.where().where()` or `.where().execute()` interchangeably.
function makeTrx(opts: { rows?: unknown[]; upsertRow?: unknown; deleted?: unknown[] } = {}): Record<string, unknown> {
  const { rows = [], upsertRow = makeDeviceRow(), deleted = [] } = opts;
  const tx: Record<string, unknown> = {
    selectFrom: vi.fn(() => new Proxy(makeQuery(rows), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => t);
      },
    })),
    insertInto: vi.fn(() => new Proxy(makeQuery(upsertRow), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => t);
      },
    })),
    deleteFrom: vi.fn(() => new Proxy(makeQuery(deleted), {
      get(t, prop) {
        if (prop in t) return (t as Record<string, unknown>)[prop as string];
        return vi.fn(() => t);
      },
    })),
  };
  return tx;
}

function makeDeviceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'd-1',
    user_id: 'u-1',
    city_id: 'c-1',
    device_id: 'device-fp',
    platform: 'ios',
    expo_push_token: 'ExponentPushToken[abc]',
    app_version: '1.0.0',
    locale: 'en',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
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

describe('MeService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('list returns the user devices ordered by created_at desc', async () => {
    const rows = [makeDeviceRow({ id: 'd-2' }), makeDeviceRow({ id: 'd-1' })];
    const trx = makeTrx({ rows });
    const svc = new MeService(makeDb(trx), audit);

    const out = await svc.list(user, tenant);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('d-2');
    expect(out[0].platform).toBe('ios');
    expect((trx.selectFrom as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('devices');
  });

  it('register upserts on (user_id, device_id) and writes device.register audit row in same tx', async () => {
    const row = makeDeviceRow({ device_id: 'mobile-uuid' });
    const trx = makeTrx({ upsertRow: row });
    const svc = new MeService(makeDb(trx), audit);

    const out = await svc.register(
      {
        device_id: 'mobile-uuid',
        platform: 'ios',
        expo_push_token: 'ExponentPushToken[abc]',
        app_version: '1.0.0',
        locale: 'en',
      },
      user,
      tenant,
    );
    expect(out.id).toBe('d-1');
    expect(out.deviceId).toBe('mobile-uuid');
    expect((trx.insertInto as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('devices');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('device.register');
    expect(ev.targetType).toBe('device');
    expect(ev.payload.device_id).toBe('mobile-uuid');
    expect(ev.payload.platform).toBe('ios');
  });

  it('register accepts device_platform alias used by the mobile', async () => {
    const row = makeDeviceRow({ platform: 'android' });
    const trx = makeTrx({ upsertRow: row });
    const svc = new MeService(makeDb(trx), audit);

    const out = await svc.register(
      {
        device_platform: 'android',
        expo_push_token: 'ExponentPushToken[abc]',
        app_version: '1.0.0',
        locale: 'en',
      },
      user,
      tenant,
    );
    expect(out.platform).toBe('android');
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.payload.platform).toBe('android');
  });

  it('register derives device_id from expo_push_token when client omits it', async () => {
    const row = makeDeviceRow();
    const trx = makeTrx({ upsertRow: row });
    const svc = new MeService(makeDb(trx), audit);

    await svc.register(
      {
        platform: 'ios',
        expo_push_token: 'ExponentPushToken[abc]',
        app_version: '1.0.0',
        locale: 'en',
      },
      user,
      tenant,
    );
    const ev = writeSpy.mock.calls[0]?.[1];
    // sha256 of the token — stable, length 32 hex chars.
    expect(ev.payload.device_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('revoke deletes the (user_id, device_id) row and writes device.revoke audit row', async () => {
    const trx = makeTrx({ deleted: [{ id: 'd-1' }] });
    const svc = new MeService(makeDb(trx), audit);

    await svc.revoke('mobile-uuid', user, tenant);
    expect((trx.deleteFrom as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('devices');
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('device.revoke');
    expect(ev.targetId).toBe('mobile-uuid');
    expect(ev.payload.deleted).toBe(1);
  });

  it('revoke is idempotent — no row deleted still writes an audit row', async () => {
    const trx = makeTrx({ deleted: [] });
    const svc = new MeService(makeDb(trx), audit);

    await svc.revoke('unknown-device', user, tenant);
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('device.revoke');
    expect(ev.payload.deleted).toBe(0);
  });
});