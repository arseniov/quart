// src/theme/__tests__/nativewind.test.ts
jest.mock('react-native', () => ({
  Appearance: { getColorScheme: jest.fn() },
  useColorScheme: jest.fn(),
}));

import { Appearance } from 'react-native';
import { colorScheme } from '../nativewind';

describe('colorScheme', () => {
  it('returns light when Appearance is light', () => {
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('light');
    expect(colorScheme()).toBe('light');
  });

  it('returns dark when Appearance is dark', () => {
    (Appearance.getColorScheme as jest.Mock).mockReturnValue('dark');
    expect(colorScheme()).toBe('dark');
  });
});
