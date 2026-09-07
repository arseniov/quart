import { describe, it, expect } from 'vitest';

import { canonicalJson, canonicalSha256 } from '../canonical-json.js';

describe('canonicalJson', () => {
  it('sorts object keys lexicographically at every depth', () => {
    const a = canonicalJson({ b: 1, a: { z: 1, y: 2 } });
    const b = canonicalJson({ a: { y: 2, z: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    const a = canonicalJson([3, 1, 2]);
    const b = canonicalJson([3, 1, 2]);
    expect(a).toBe(b);
    const c = canonicalJson([1, 3, 2]);
    expect(c).not.toBe(a);
  });

  it('excludes undefined values from objects', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('handles nested arrays of objects', () => {
    const a = canonicalJson([
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ]);
    expect(a).toBe('[{"a":1,"b":2},{"c":3,"d":4}]');
  });
});

describe('canonicalSha256', () => {
  it('produces stable sha256 hex', () => {
    const h = canonicalSha256({ a: 1, b: 'x' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(canonicalSha256({ b: 'x', a: 1 }));
  });
});
