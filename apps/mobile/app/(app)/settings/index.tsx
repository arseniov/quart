// app/(app)/settings/index.tsx
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@/api/hooks/useMe';
import { clearTokens } from '@/lib/auth';

const ITEMS = [
  { key: 'account', href: '/settings/account' as const },
  { key: 'notifications', href: '/settings/notifications' as const },
  { key: 'language', href: '/settings/language' as const },
  { key: 'privacy', href: '/settings/privacy' as const },
  { key: 'about', href: '/settings/about' as const },
];

export default function SettingsIndex() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const onLogout = async () => {
    await clearTokens();
    qc.clear();
    router.replace('/login');
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.title') }} />
      <FlatList
        data={ITEMS}
        keyExtractor={(i) => i.key}
        ListHeaderComponent={
          me ? (
            <View className="px-4 py-3 border-b border-border">
              <Text className="text-text-secondary">@{me.handle}</Text>
            </View>
          ) : null
        }
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
        ListFooterComponent={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.logout')}
            onPress={onLogout}
            className="mx-4 my-6 bg-surface border border-error rounded-md p-3 items-center"
          >
            <Text className="text-error font-semibold">{t('settings.logout')}</Text>
          </Pressable>
        }
      />
    </View>
  );
}
