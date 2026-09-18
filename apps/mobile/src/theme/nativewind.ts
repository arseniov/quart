// src/theme/nativewind.ts
import { useColorScheme as useSystemColorScheme } from 'react-native';
import { Appearance } from 'react-native';

export type ColorMode = 'light' | 'dark';

export function colorScheme(): ColorMode {
  return (Appearance.getColorScheme() ?? 'light') as ColorMode;
}

export function useColorScheme(): ColorMode {
  return (useSystemColorScheme() ?? 'light') as ColorMode;
}
