// src/theme/__tests__/nativewind.test.ts
import { colorScheme } from '../nativewind';

describe('colorScheme', () => {
  it('returns light or dark', () => {
    expect(['light', 'dark']).toContain(colorScheme());
  });
});
