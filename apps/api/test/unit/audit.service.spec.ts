import { describe, it, expect, vi } from 'vitest';
import { AuditService } from '../../src/audit/audit.service.js';
import { computeRowHash, GENESIS_PREV_HASH } from '@quart/db';

// ponytail: Kysely query-builder shape can't be expressed statically without
// the real types; the stubs only need to return the rows buildRow reads.
function makeDb(opts: { maxId?: bigint | number; lastRow?: { row_hash: string } | null }) {
  const last = opts.maxId === undefined || opts.maxId === 0
    ? { max_id: 0 }
    : { max_id: opts.maxId };
  const lastRow = opts.lastRow ?? null;
  let auditLogCalls = 0;
  return {
    selectFrom: (table: unknown) => {
      if (table === 'audit_log') {
        auditLogCalls++;
        if (auditLogCalls === 1) {
          return {
            select: () => ({ executeTakeFirst: vi.fn(async () => last) }),
          };
        }
        return {
          select: () => ({ where: () => ({ executeTakeFirst: vi.fn(async () => lastRow) }) }),
        };
      }
      return {
        select: () => ({ where: () => ({ executeTakeFirstOrThrow: vi.fn(async () => ({ id: 'kv-1' })) }) }),
      };
    },
    insertInto: () => ({ values: () => ({ executeTakeFirstOrThrow: vi.fn(async () => ({ id: 100n })) }) }),
  };
}

describe('AuditService.buildRow', () => {
  it('returns prev_hash from previous row and computes row_hash', async () => {
    const svc = new AuditService({ env: { AUDIT_HMAC_KEY: 'a'.repeat(64) } } as never);
    const db = makeDb({ maxId: 99n, lastRow: { row_hash: 'b'.repeat(64) } });
    const row = await svc.buildRow(db as never, {
      tenant: { cityId: 'c', userId: 'u', isSuperAdmin: false, requestId: 'r' },
      action: 'issue.create',
      targetType: 'issue',
      targetId: 'iss-1',
      payload: { foo: 'bar' },
      ip: '1.2.3.4',
      userAgent: 'ua',
    });
    expect(row.prev_hash).toBe('b'.repeat(64));
    expect(row.row_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRowHash({ prev_hash: row.prev_hash, payload_canonical_sha256: row.payload_canonical_sha256 }, 'a'.repeat(64))).toBe(row.row_hash);
  });

  it('uses GENESIS_PREV_HASH when no previous row exists', async () => {
    const svc = new AuditService({ env: { AUDIT_HMAC_KEY: 'a'.repeat(64) } } as never);
    const db = makeDb({ maxId: 0 });
    const row = await svc.buildRow(db as never, {
      tenant: { cityId: 'c', userId: 'u', isSuperAdmin: false, requestId: 'r' },
      action: 'issue.create', targetType: 'issue', targetId: 'iss-1',
      payload: { foo: 'bar' }, ip: '1.2.3.4', userAgent: 'ua',
    });
    expect(row.prev_hash).toBe(GENESIS_PREV_HASH);
  });

  // ponytail: belt-and-suspenders for the requestId coercion — the
  // middleware accepts any /^[A-Za-z0-9_-]{8,128}$/ header, so a
  // `req-N` string flows through to the audit insert. Coerce to NULL
  // instead of letting pg reject with 22P02 (gh issue #3).
  it.each(['', 'req-abc12345', 'sweeper', 'not-a-uuid-at-all'])(
    'coerces non-UUID requestId %j to NULL (avoids 22P02 on audit insert)',
    async (bad) => {
      const svc = new AuditService({ env: { AUDIT_HMAC_KEY: 'a'.repeat(64) } } as never);
      const db = makeDb({ maxId: 0 });
      const row = await svc.buildRow(db as never, {
        tenant: { cityId: 'c', userId: 'u', isSuperAdmin: false, requestId: bad },
        action: 'issue.create', targetType: 'issue', targetId: 'iss-1',
        payload: {}, ip: null, userAgent: null,
      });
      expect(row.request_id).toBeNull();
    },
  );

  it('passes through a valid UUID requestId unchanged', async () => {
    const svc = new AuditService({ env: { AUDIT_HMAC_KEY: 'a'.repeat(64) } } as never);
    const db = makeDb({ maxId: 0 });
    const uuid = '11111111-2222-3333-4444-555555555555';
    const row = await svc.buildRow(db as never, {
      tenant: { cityId: 'c', userId: 'u', isSuperAdmin: false, requestId: uuid },
      action: 'issue.create', targetType: 'issue', targetId: 'iss-1',
      payload: {}, ip: null, userAgent: null,
    });
    expect(row.request_id).toBe(uuid);
  });
});