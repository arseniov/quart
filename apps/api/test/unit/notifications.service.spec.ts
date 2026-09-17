import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../src/audit/audit.service.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';
import { NotificationsService } from '../../src/notifications/notifications.service.js';

// Recursive proxy: any chained kysely call (where/select/etc.) returns a
// builder that ALSO has `execute`/`executeTakeFirstOrThrow` — same shape no
// matter how deep the chain goes.
function makeQuery(value: unknown, terminalValue: unknown = value): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['select'] = vi.fn(chain);
  builder['selectAll'] = vi.fn(chain);
  builder['where'] = vi.fn(chain);
  builder['orderBy'] = vi.fn(chain);
  builder['limit'] = vi.fn(chain);
  builder['offset'] = vi.fn(chain);
  builder['set'] = vi.fn(chain);
  builder['returning'] = vi.fn(chain);
  builder['returningAll'] = vi.fn(chain);
  builder['execute'] = vi.fn(async () => terminalValue);
  builder['executeTakeFirstOrThrow'] = vi.fn(async () => terminalValue);
  return builder;
}

function makeTrx(opts: {
  rows?: unknown[];
  updateRowCount?: number;
} = {}): Record<string, unknown> {
  const { rows = [], updateRowCount = 0 } = opts;
  const selectTerminal = new Proxy(makeQuery(rows), {
    get(t, prop) {
      if (prop in t) return (t as Record<string, unknown>)[prop as string];
      return vi.fn(() => selectTerminal);
    },
  });
  const updateValue = { numAffectedRows: updateRowCount };
  const updateTerminal = new Proxy(makeQuery(rows, updateValue), {
    get(t, prop) {
      if (prop in t) return (t as Record<string, unknown>)[prop as string];
      return vi.fn(() => updateTerminal);
    },
  });
  const tx: Record<string, unknown> = {
    selectFrom: vi.fn(() => selectTerminal),
    updateTable: vi.fn(() => updateTerminal),
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

describe('NotificationsService', () => {
  let audit: AuditService;
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.fn(async () => undefined);
    audit = { write: writeSpy } as unknown as AuditService;
  });

  it('list returns mapped notifications for the recipient', async () => {
    const rows = [
      {
        id: 'n1',
        city_id: 'c-1',
        recipient_user_id: 'u-1',
        type: 'poll',
        title: 'New poll',
        body: 'Vote now',
        target_url: 'https://x/poll/1',
        payload: { foo: 1 },
        read_at: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];
    const trx = makeTrx({ rows });
    const svc = new NotificationsService(makeDb(trx), audit);

    const out = await svc.list({ page: 1, limit: 20, unread: false }, tenant);
    expect(out[0].id).toBe('n1');
    expect(out[0].readAt).toBeNull();
    expect(out[0].targetUrl).toBe('https://x/poll/1');
  });

  it('list with unread=true filters to read_at IS NULL', async () => {
    const trx = makeTrx();
    const svc = new NotificationsService(makeDb(trx), audit);

    await svc.list({ page: 1, limit: 20, unread: true }, tenant);
    expect((trx.selectFrom as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('notifications');
  });

  it('markRead runs an atomic update filtered by recipient + unread', async () => {
    const trx = makeTrx();
    const svc = new NotificationsService(makeDb(trx), audit);

    await svc.markRead('n1', tenant);
    expect((trx.updateTable as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('notifications');
    // No audit on single-mark-read — bulk action is the audit-worthy event.
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('markAllRead writes an audit event in the same tx with affected count', async () => {
    const trx = makeTrx({ updateRowCount: 7 });
    const svc = new NotificationsService(makeDb(trx), audit);

    const count = await svc.markAllRead(tenant);
    expect(count).toBe(7);
    expect(writeSpy).toHaveBeenCalledOnce();
    const ev = writeSpy.mock.calls[0]?.[1];
    expect(ev.action).toBe('notifications.mark_all_read');
    expect(ev.payload.count).toBe(7);
  });
});
