// tailwind.config.ts
import type { Config } from 'tailwindcss';
import { tokens } from './src/theme/tokens';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: tokens.color.bg,
        surface: tokens.color.surface,
        text: {
          primary: tokens.color.text.primary,
          secondary: tokens.color.text.secondary,
          onPrimary: tokens.color.text.onPrimary,
        },
        primary: tokens.color.primary,
        success: tokens.color.success,
        warning: tokens.color.warning,
        error: tokens.color.error,
        info: tokens.color.info,
        border: tokens.color.border,
      },
      spacing: tokens.spacing,
      borderRadius: tokens.radius,
      // ponytail: GH #28 — vendor Inter. font-sans → 'Inter' (Regular).
      //          Overriding fontFamily.bold/semibold to 'Inter-SemiBold' makes
      //          className="font-semibold" resolve to a family swap (not just
      //          numeric fontWeight, which RN ignores for custom fonts). The 55+
      //          existing `font-semibold` usages across the app start rendering
      //          semibold without per-component edits.
      fontFamily: {
        sans: ['Inter'],
        bold: ['Inter-SemiBold'],
        semibold: ['Inter-SemiBold'],
      },
      fontSize: tokens.fontSize,
      fontWeight: tokens.fontWeight,
      lineHeight: tokens.lineHeight,
    },
  },
  plugins: [],
};

export default config;
