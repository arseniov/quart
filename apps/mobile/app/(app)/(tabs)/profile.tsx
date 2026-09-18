// app/(app)/(tabs)/profile.tsx
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import { ProfileHeader } from '@/components/profile/ProfileHeader';

const LINKS = [
  { key: 'settings', href: '/settings' as const },
  { key: 'notifications', href: '/settings/notifications' as const },
  { key: 'saved', href: '/saved' as const },
];

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('nav.profile') }} />
      <FlatList
        data={LINKS}
        keyExtractor={(l) => l.key}
        ListHeaderComponent={<ProfileHeader />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(`settings.${item.key}`)}
            onPress={() => router.push(item.href)}
            className="px-4 py-3 border-b border-border bg-bg"
          >
            <Text className="text-text-primary">{t(`settings.${item.key}`)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
