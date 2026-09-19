// src/components/auth/SocialButton.tsx
// Generic social-sign-in button. Styling per-provider follows Apple's HIG
// (black bg, white label) and Google's branding (white bg, bordered).
// ponytail: no bundled brand logos — text-only is acceptable for non-shipping mockups;
//        add SVG assets and use expo-auth-session's provider button once finalized for store.
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

export function SocialButton({ provider, label, onPress, disabled }: SocialButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      className={`rounded-md p-3 items-center mt-3 ${containerClass[provider]} ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`font-semibold ${labelClass[provider]}`}>{label}</Text>
    </Pressable>
  );
}