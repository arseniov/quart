// src/components/ui/Avatar.tsx
import { View, Text, Image, type ImageSourcePropType } from 'react-native';
import { tokens } from '@/theme/tokens';

interface AvatarProps {
  uri: string | null;
  name: string;
  size?: number;
}

export function Avatar({ uri, name, size = 64 }: AvatarProps) {
  if (uri) {
    return (
      <Image
        source={{ uri } as ImageSourcePropType}
        accessibilityLabel={`Avatar of ${name}`}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const fontSize = Math.max(tokens.fontSize.md, Math.round(size * 0.4));
  return (
    <View
      accessibilityLabel={`Avatar placeholder for ${name}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tokens.color.primary.light,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: tokens.color.text.onPrimary.light, fontSize, fontWeight: '600' }}>
        {initial}
      </Text>
    </View>
  );
}
