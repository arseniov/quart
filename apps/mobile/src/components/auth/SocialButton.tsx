// src/components/auth/SocialButton.tsx
// Generic social-sign-in button. Styling per-provider follows Apple's HIG
// (black bg, white glyph + label) and Google's branding (white bg, bordered,
// multi-color G glyph + label). SVGs vendored under assets/icons/.
import { Image } from 'expo-image';
import { Pressable, Text } from 'react-native';

import type { SocialProvider } from '@/api/hooks/useSocialLogin';

interface SocialButtonProps {
  provider: SocialProvider;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

const containerClass: Record<SocialProvider, string> = {
  apple: 'bg-black border border-black',
  google: 'bg-surface border border-border',
};

const labelClass: Record<SocialProvider, string> = {
  apple: 'text-white',
  google: 'text-text-primary',
};

// ponytail: expo-image's SVG decoder renders the vendored glyphs without a
//        new dependency; width/height tuned to match the native iOS HIG
//        sign-in button proportions (~22pt inside a 44pt tap target).
const iconSource: Record<SocialProvider, number> = {
  apple: require('../../../assets/icons/apple-logo.svg'),
  google: require('../../../assets/icons/google-logo.svg'),
};

export function SocialButton({ provider, label, onPress, disabled }: SocialButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      className={`flex-row rounded-md p-3 items-center justify-center mt-3 ${containerClass[provider]} ${disabled ? 'opacity-50' : ''}`}
    >
      <Image
        source={iconSource[provider]}
        testID={`social-icon-${provider}`}
        style={{ width: 20, height: 20, marginRight: 8 }}
      />
      <Text className={`font-semibold ${labelClass[provider]}`}>{label}</Text>
    </Pressable>
  );
}