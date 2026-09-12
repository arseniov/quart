import { describe, it, expect, vi } from 'vitest';
import { computeRowHash, GENESIS_PREV_HASH } from '@quart/db';

import { VerifyController } from '../../src/audit/verify.controller.js';

// ponytail: Kysely query-builder shape can't be expressed statically without
// the real types; the stub mirrors DbService.kysely and only needs to return
// the rows the verify walks.
function makeDb(rows: unknown[]) {
  const kysely = {
    selectFrom: () => ({
      select: () => ({
        orderBy: () => ({
          execute: vi.fn(async () => rows),
        }),
      }),
    }),
  };
  return { kysely };
}

describe('VerifyController.verify', () => {
  it('returns ok when all rows form a valid chain', async () => {
    const h1 = computeRowHash({ prev_hash: GENESIS_PREV_HASH, payload_canonical_sha256: 'a'.repeat(64) }, 'k'.repeat(64));
    const h2 = computeRowHash({ prev_hash: h1, payload_canonical_sha256: 'b'.repeat(64) }, 'k'.repeat(64));
    const db = makeDb([
      { id: 1n, prev_hash: GENESIS_PREV_HASH, payload_canonical_sha256: 'a'.repeat(64), row_hash: h1 },
      { id: 2n, prev_hash: h1, payload_canonical_sha256: 'b'.repeat(64), row_hash: h2 },
    ]);
    const c = new VerifyController(db as never, { env: { AUDIT_HMAC_KEY: 'k'.repeat(64) } } as never);
    const r = await c.verify();
    expect(r.status).toBe('ok');
    expect(r.checked).toBe(2);
  });

  it('returns broken on hash mismatch', async () => {
    const h1 = computeRowHash({ prev_hash: GENESIS_PREV_HASH, payload_canonical_sha256: 'a'.repeat(64) }, 'k'.repeat(64));
    const db = makeDb([
      { id: 1n, prev_hash: GENESIS_PREV_HASH, payload_canonical_sha256: 'a'.repeat(64), row_hash: h1 },
      { id: 2n, prev_hash: 'x'.repeat(64), payload_canonical_sha256: 'b'.repeat(64), row_hash: '0'.repeat(64) },
    ]);
    const c = new VerifyController(db as never, { env: { AUDIT_HMAC_KEY: 'k'.repeat(64) } } as never);
    const r = await c.verify();
    expect(r.status).toBe('broken');
    expect(r.broken_at_id).toBe('2');
  });
});