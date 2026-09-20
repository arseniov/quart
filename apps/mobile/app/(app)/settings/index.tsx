// app/(app)/settings/index.tsx
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { useMe } from '@/api/hooks/useMe';
import { clearTokens } from '@/lib/auth';
import { getStorageStats, formatBytes, type StorageStats } from '@/lib/tile-cache';

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
  const [stats, setStats] = useState<StorageStats>({ bundleCount: 0, totalBytes: 0, bundles: [] });

  // ponytail: kick off the first load in an effect so the badge reflects any seeded bundles
  //          on first paint. useFocusEffect below refreshes on every screen focus without a
  //          global event bus. Becomes a subscription if more screens care.
  useEffect(() => {
    void getStorageStats().then(setStats);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void getStorageStats().then(setStats);
    }, []),
  );

  const offlineLabel =
    stats.bundleCount === 0
      ? t('map.offline.download')
      : t('map.offline.storageUsed', { size: formatBytes(stats.totalBytes) });

  const onLogout = async () => {
    // GH #32 / §3.8 — POST /auth/sign-out so the server writes the auth.sign_out audit
    // row and the HMAC chain records the session lifetime ending. Local logout must still
    // complete if the API is unreachable (offline / revocation).
    try {
      // JWT must still be in MMKV at request time — clearTokens() runs AFTER the POST.
      await apiClient.post('/auth/sign-out', null);
    } catch (err) {
      console.warn('[settings] sign-out request failed', err);
    }
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
          <View>
            <View className="px-4 py-3 border-b border-border" accessibilityRole="summary">
              <Text className="text-text-secondary text-xs uppercase mb-1">
                {t('settings.offlineMaps')}
              </Text>
              <Text className="text-text-primary">{offlineLabel}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.logout')}
              onPress={onLogout}
              className="mx-4 my-6 bg-surface border border-error rounded-md p-3 items-center"
            >
              <Text className="text-error font-semibold">{t('settings.logout')}</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}