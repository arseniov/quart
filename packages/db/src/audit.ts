import { createHmac } from 'node:crypto';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function computeRowHash(
  row: { prev_hash: string; payload_canonical_sha256: string },
  keyHex: string = '0'.repeat(64),
): string {
  const key = Buffer.from(keyHex, 'hex');
  const hmac = createHmac('sha256', key);
  hmac.update(row.prev_hash);
  hmac.update(row.payload_canonical_sha256);
  return hmac.digest('hex');
}
