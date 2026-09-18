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
      fontSize: tokens.fontSize,
      fontWeight: tokens.fontWeight,
    },
  },
  plugins: [],
};

export default config;
