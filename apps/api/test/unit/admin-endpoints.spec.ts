import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuditController } from '../../src/admin/admin-audit.controller.js';
import { AdminCitiesController } from '../../src/admin/admin-cities.controller.js';
import { AdminI18nController } from '../../src/admin/admin-i18n.controller.js';
import { AdminIdeasController } from '../../src/admin/admin-ideas.controller.js';
import { AdminOfficersController } from '../../src/admin/admin-officers.controller.js';
import { AdminPollsController } from '../../src/admin/admin-polls.controller.js';
import { AdminRolesController } from '../../src/admin/admin-roles.controller.js';
import { AdminSettingsController } from '../../src/admin/admin-settings.controller.js';
import { AdminTaxonomiesController } from '../../src/admin/admin-taxonomies.controller.js';
import { AdminUsersController } from '../../src/admin/admin-users.controller.js';
import type { AuditService } from '../../src/audit/audit.service.js';
import type { DbService } from '../../src/db/db.service.js';
import type { TenantContext } from '../../src/db/run-in-tenant-tx.js';

// ----------------------------------------------------------------------------
// Trx stub: every terminal resolves to the next row in the queue. The chain
// shape mirrors Kysely — `values()...returning()...executeTakeFirstOrThrow()`
// returns one row; `select().where()...execute()` returns an array.
// ----------------------------------------------------------------------------
type Row = Record<string, unknown>;

function makeTrx(scenarios: Row[][]) {
  const queue: Row[][] = [...scenarios];
  const terminal = {
    execute: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return next;
    }),
    executeTakeFirst: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('trx stub: out of queued rows');
      return next[0];
    }),
    executeTakeFirstOrThrow: vi.fn(async () => {
      const next = queue.shift();
      if (!next || next.length === 0) throw new Error('trx stub: no row');
      return next[0];
    }),
  };
  const handler = {
    get(t: Record<string, unknown>, prop: string | symbol) {
      if (prop in t) return (t as Record<string, unknown>)[prop as string];
      return () => new Proxy(t, handler);
    },
  };
  const trx = new Proxy(terminal, handler) as unknown as Record<string, unknown>;
  return { trx };
}

function makeDb(scenarios: Row[][]) {
  const { trx } = makeTrx(scenarios);
  const db = {
    runInTenantTx: vi.fn(async (_ctx: TenantContext, fn: (t: unknown) => Promise<unknown>) => fn(trx)),
  } as unknown as DbService;
  return { db, trx };
}

const tenant: TenantContext = {
  cityId: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  isSuperAdmin: false,
  requestId: 'req-1',
};

function makeAudit(): AuditService {
  return { write: vi.fn(), buildRow: vi.fn() } as unknown as AuditService;
}

// ============================================================================
// Polls
// ============================================================================
describe('AdminPollsController', () => {
  let db: DbService;
  let audit: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ db } = makeDb([[{ id: 'p1' }]]));
    audit = makeAudit();
  });

  it('create persists a new poll', async () => {
    const c = new AdminPollsController(db, audit);
    const r = await c.create(
      {
        cityId: '11111111-1111-1111-1111-111111111111',
        titleI18n: { it: 'x' },
        opensAt: new Date('2026-01-01').toISOString(),
        closesAt: new Date('2026-01-08').toISOString(),
        options: [{ label: { it: 'a' } }, { label: { it: 'b' } }],
      },
      { id: 'u', cityId: '11111111-1111-1111-1111-111111111111', isSuperAdmin: false, roleSnapshot: [] },
      tenant,
    );
    expect(r.id).toBe('p1');
    expect(audit.write).toHaveBeenCalledOnce();
  });

  it('close updates status and writes audit', async () => {
    const { db: db2, trx } = makeDb([[], []]);
    audit = makeAudit();
    const c = new AdminPollsController(db2, audit);
    await c.close('p1', { id: 'u', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: [] }, tenant);
    expect(audit.write).toHaveBeenCalledOnce();
    expect(audit.write.mock.calls[0]![0]).toBe(trx);
  });
});

// ============================================================================
// Ideas
// ============================================================================
describe('AdminIdeasController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moderate updates status and writes audit', async () => {
    const { db } = makeDb([[], []]);
    const audit = makeAudit();
    const c = new AdminIdeasController(db, audit);
    const r = await c.moderate(
      'i1',
      { action: 'publish' },
      { id: 'u', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: ['moderator'] },
      tenant,
    );
    expect(r.ok).toBe(true);
    expect(audit.write).toHaveBeenCalledOnce();
  });

  it('throws Forbidden when caller lacks moderator role and is not super-admin', async () => {
    const { db } = makeDb([[]]);
    const audit = makeAudit();
    const c = new AdminIdeasController(db, audit);
    await expect(
      c.moderate('i1', { action: 'hide' }, { id: 'u', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: [] }, tenant),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.write).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Users
// ============================================================================
describe('AdminUsersController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('patch replaces user_roles for the target user and writes audit', async () => {
    const { db, trx } = makeDb([[], [{ id: 'ur1' }], []]);
    const audit = makeAudit();
    const c = new AdminUsersController(db, audit);
    const r = await c.patchUser(
      'u1',
      { roleIds: ['33333333-3333-3333-3333-333333333333'] },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: ['quart_admin'] },
      tenant,
    );
    expect(r.ok).toBe(true);
    expect(audit.write).toHaveBeenCalledOnce();
    expect(audit.write.mock.calls[0]![0]).toBe(trx);
  });
});

// ============================================================================
// Roles
// ============================================================================
describe('AdminRolesController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create returns new role id', async () => {
    const { db } = makeDb([[{ id: 'r1' }]]);
    const audit = makeAudit();
    const c = new AdminRolesController(db, audit);
    const r = await c.create(
      { code: 'x', name: 'X', isOfficer: false },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] },
      tenant,
    );
    expect(r.id).toBe('r1');
  });
});

// ============================================================================
// Cities (super-admin only)
// ============================================================================
describe('AdminCitiesController — super-admin only', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create rejects non-super-admin', async () => {
    const { db } = makeDb([[{ id: 'c1' }]]);
    const audit = makeAudit();
    const c = new AdminCitiesController(db, audit);
    await expect(
      c.create(
        { slug: 'x', countryCode: 'IT', name: 'X', localeDefault: 'it', timezone: 'Europe/Rome' },
        { id: 'u', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: ['quart_admin'] },
        tenant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('create allows super-admin', async () => {
    const { db } = makeDb([[{ id: 'c1' }]]);
    const audit = makeAudit();
    const c = new AdminCitiesController(db, audit);
    const r = await c.create(
      { slug: 'x', countryCode: 'IT', name: 'X', localeDefault: 'it', timezone: 'Europe/Rome' },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] },
      tenant,
    );
    expect(r.id).toBe('c1');
    expect(audit.write).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Officers — scope-invariant case
// ============================================================================
describe('AdminOfficersController — invite scope invariant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects cross-city invite', async () => {
    const { db } = makeDb([[]]);
    const audit = makeAudit();
    const c = new AdminOfficersController(db, audit);
    await expect(
      c.invite(
        {
          email: 'a@b',
          roleId: '33333333-3333-3333-3333-333333333333',
          scope: { scopeType: 'city', scopeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        },
        { id: 'u', cityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', isSuperAdmin: false, roleSnapshot: ['quart_admin'] },
        tenant,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('accepts same-city invite and writes audit', async () => {
    const { db } = makeDb([[{ id: 'inv-1' }]]);
    const audit = makeAudit();
    const c = new AdminOfficersController(db, audit);
    const r = await c.invite(
      {
        email: 'a@b',
        roleId: '33333333-3333-3333-3333-333333333333',
        scope: { scopeType: 'city', scopeId: tenant.cityId },
      },
      { id: 'u', cityId: tenant.cityId, isSuperAdmin: false, roleSnapshot: ['quart_admin'] },
      tenant,
    );
    expect(r.id).toBe('inv-1');
    expect(audit.write).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Audit
// ============================================================================
describe('AdminAuditController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list filters by actor and date range', async () => {
    const { db } = makeDb([[{ id: 'a1' }]]);
    const c = new AdminAuditController(db);
    const r = await c.list(
      { actor: 'u1', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', page: 1 },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] },
      tenant,
    );
    expect(r.length).toBe(1);
    expect(db.runInTenantTx).toHaveBeenCalled();
  });
});

// ============================================================================
// Settings
// ============================================================================
describe('AdminSettingsController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('patch upserts key/value rows', async () => {
    const { db } = makeDb([[], []]);
    const audit = makeAudit();
    const c = new AdminSettingsController(db, audit);
    const r = await c.patch(
      { featureFlags: { new_ui: true } },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] },
      tenant,
    );
    expect(r.ok).toBe(true);
    expect(audit.write).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Taxonomies
// ============================================================================
describe('AdminTaxonomiesController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list returns topic + issue categories', async () => {
    const { db } = makeDb([[{ id: 'tc1' }], [{ id: 'ic1' }]]);
    const c = new AdminTaxonomiesController(db);
    const r = await c.list({ id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] }, tenant);
    expect(r.topicCategories.length).toBe(1);
    expect(r.issueCategories.length).toBe(1);
  });
});

// ============================================================================
// i18n
// ============================================================================
describe('AdminI18nController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('patchKey writes translation under app_settings', async () => {
    const { db } = makeDb([[]]);
    const audit = makeAudit();
    const c = new AdminI18nController(db, audit);
    const r = await c.patchKey(
      'home.title',
      { locale: 'it', value: 'Benvenuto' },
      { id: 'admin', cityId: tenant.cityId, isSuperAdmin: true, roleSnapshot: [] },
      tenant,
    );
    expect(r.ok).toBe(true);
    expect(audit.write).toHaveBeenCalledOnce();
  });
});
