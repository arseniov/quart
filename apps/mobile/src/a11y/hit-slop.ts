// src/a11y/hit-slop.ts
// WCAG 2.5.5 target size — 44x44 pt minimum. Use as a Pressable/Touchable hitSlop
// to keep the visible button smaller while preserving the accessible tap area.
export type HitSlop = { top: number; bottom: number; left: number; right: number };

const WCAG_TARGET = 44;

export function minHitSlop(size: number = WCAG_TARGET): HitSlop {
  const pad = Math.max(0, (size - WCAG_TARGET) / 2);
  return { top: pad, bottom: pad, left: pad, right: pad };
}