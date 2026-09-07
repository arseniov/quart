import { describe, it, expect } from 'vitest';

import { computeRowHash, GENESIS_PREV_HASH } from '../audit.js';

describe('computeRowHash', () => {
  it('uses GENESIS_PREV_HASH for the first row', () => {
    const h = computeRowHash({
      prev_hash: GENESIS_PREV_HASH,
      payload_canonical_sha256: 'a'.repeat(64),
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces deterministic hashes for the same input', () => {
    const input = { prev_hash: 'b'.repeat(64), payload_canonical_sha256: 'c'.repeat(64) };
    expect(computeRowHash(input)).toBe(computeRowHash(input));
  });

  it('changes when prev_hash changes', () => {
    const a = computeRowHash({
      prev_hash: 'a'.repeat(64),
      payload_canonical_sha256: 'z'.repeat(64),
    });
    const b = computeRowHash({
      prev_hash: 'b'.repeat(64),
      payload_canonical_sha256: 'z'.repeat(64),
    });
    expect(a).not.toBe(b);
  });
});
