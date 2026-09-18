// src/theme/__tests__/tokens.test.ts
import { tokens } from '../tokens';

function relLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens (WCAG 2.1 AA)', () => {
  it('text on bg passes 4.5:1 in light mode', () => {
    const ratio = contrast(tokens.color.text.primary.light, tokens.color.bg.light);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('text on bg passes 4.5:1 in dark mode', () => {
    const ratio = contrast(tokens.color.text.primary.dark, tokens.color.bg.dark);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('primary contrast vs bg passes 3:1 (UI element)', () => {
    expect(contrast(tokens.color.primary.light, tokens.color.bg.light)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens.color.primary.dark, tokens.color.bg.dark)).toBeGreaterThanOrEqual(3);
  });
});
