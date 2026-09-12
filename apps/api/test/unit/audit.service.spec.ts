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
});