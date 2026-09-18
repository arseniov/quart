// src/theme/tokens.ts
export const tokens = {
  color: {
    bg: { light: '#FFFFFF', dark: '#0A0A0A' },
    surface: { light: '#F7F7F8', dark: '#1A1A1A' },
    text: {
      primary: { light: '#0A0A0A', dark: '#FAFAFA' },
      secondary: { light: '#525252', dark: '#A1A1AA' },
      onPrimary: { light: '#FFFFFF', dark: '#0A0A0A' },
    },
    primary: { light: '#D44E15', dark: '#FF8A5C' },
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
    border: { light: '#E5E7EB', dark: '#27272A' },
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 },
  radius: { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 },
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 36 },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
  hitSlop: { min: 44 }, // WCAG 2.5.5 target size
} as const;

export type Tokens = typeof tokens;
