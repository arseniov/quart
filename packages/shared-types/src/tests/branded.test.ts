import { describe, it, expect } from 'vitest';

import { brandedIdSchema, type UserId } from '../branded.js';

describe('brandedIdSchema', () => {
  it('accepts a valid uuid and brands it', () => {
    const parsed = brandedIdSchema('user').parse('00000000-0000-0000-0000-000000000001');
    expect(parsed).toBe('00000000-0000-0000-0000-000000000001');
    // Type-only assertion
    const _typed: UserId = parsed;
    expect(_typed).toBe(parsed);
  });

  it('rejects non-uuid input', () => {
    expect(() => brandedIdSchema('user').parse('not-a-uuid')).toThrow();
  });
});
