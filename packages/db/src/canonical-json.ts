import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toCanonical(value));
}

function toCanonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite number');
    }
    if (typeof value === 'bigint') throw new TypeError('canonicalJson: bigint');
    return value;
  }
  if (Array.isArray(value)) return value.map(toCanonical);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    // k is a JSON property name being preserved (not a lookup index); output is
    // a fresh object serialized immediately via JSON.stringify below.
    // eslint-disable-next-line security/detect-object-injection
    const v = obj[k];
    if (v === undefined) continue;
    // eslint-disable-next-line security/detect-object-injection
    out[k] = toCanonical(v);
  }
  return out;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
