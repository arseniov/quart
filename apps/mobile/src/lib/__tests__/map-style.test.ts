// src/lib/__tests__/map-style.test.ts
import { osmStyle } from '../map-style';

describe('osmStyle', () => {
  it('returns a valid style URL ending in style.json', () => {
    expect(typeof osmStyle).toBe('string');
    expect(osmStyle.endsWith('style.json')).toBe(true);
  });
});
