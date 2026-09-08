import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from '../../src/common/zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('passes through valid payloads', () => {
    const out = pipe.transform({ a: 1 }, { type: 'body', metatype: undefined, data: '' });
    expect(out).toEqual({ a: 1 });
  });

  it('throws BadRequestException on invalid payload', () => {
    const schema = z.object({ email: z.string().email() });
    const p = new ZodValidationPipe(schema);
    expect(() =>
      p.transform({ email: 'no' }, { type: 'body', metatype: undefined, data: '' }),
    ).toThrow(BadRequestException);
  });

  it('returns value unchanged when no schema provided', () => {
    expect(pipe.transform('x', { type: 'param', metatype: String, data: 'k' })).toBe('x');
  });
});
