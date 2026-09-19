// src/a11y/__tests__/hit-slop.test.ts
import { minHitSlop } from '../hit-slop';

describe('a11y minHitSlop', () => {
  // ponytail: formula is (size - 44)/2 — adding pad when the touch area exceeds
  // the WCAG 44pt minimum so callers can opt into a larger tap area.
  it('returns zero padding for the 44pt WCAG target', () => {
    expect(minHitSlop(44)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('defaults to the 44pt target when called with no args', () => {
    expect(minHitSlop()).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('scales padding by half the excess when target is larger than 44', () => {
    expect(minHitSlop(60)).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
  });

  it('clamps to zero padding when target is smaller than the 44pt baseline', () => {
    expect(minHitSlop(20)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});