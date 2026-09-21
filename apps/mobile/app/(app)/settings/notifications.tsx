// app/(app)/settings/notifications.tsx
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';

import { apiClient } from '@/api/client';
import { useTopics } from '@/api/hooks/useTopics';
import {
  useTopicSubscriptions,
  useUpdateTopicSubscriptions,
} from '@/api/hooks/useUpdatePrefs';
import i18n from '@/i18n';

export default function NotificationsSettings() {
  const { t } = useTranslation();
  const lng = i18n.language ?? 'en';
  const { data: topics, isPending: topicsPending } = useTopics();
  const { data: subs = { topic_ids: [] }, isPending: subsPending } = useTopicSubscriptions();
  const subscribed = subs.topic_ids;
  const update = useUpdateTopicSubscriptions();

  const toggleTopic = (id: string) => {
    const next = subscribed.includes(id)
      ? subscribed.filter((x) => x !== id)
      : [...subscribed, id];
    update.mutate(next, { onError: () => Alert.alert(t('errors.generic')) });
  };

  const onPushToggle = async (value: boolean) => {
    if (!value) {
      // GH #38: revoke OS-level push permission so users who said "yes" once
      // but change their mind in settings stop receiving pushes.
      // unregisterForNotificationsAsync() asks FCM/APNs to drop the push token
      // for this device — the actual mechanism that stops deliveries.
      // Token is never cached in MMKV — register flow calls
      // Notifications.getExpoPushTokenAsync() fresh each time, so there's
      // nothing to clear here. The backend DELETE is best-effort because the
      // endpoint may not exist yet (GH #51).
      try {
        await Notifications.unregisterForNotificationsAsync();
      } catch (err) {
        // ponytail: log only — OS unregister rejection is expected when no push
        //          token is registered; backend DELETE 404s are tracked by GH #51.
        console.warn('[notifications] revoke:os_unregister', err);
      }
      // Best-effort backend cleanup. Endpoint may not exist yet; sweepers mark
      // stale tokens invalid anyway, so a failed DELETE is not load-bearing.
      try {
        await apiClient.del('/me/devices');
      } catch (err) {
        // ponytail: log only — /me/devices 404 is tracked by GH #51; we
        //          don't surface server-side revocation failures to the user.
        console.warn('[notifications] revoke:backend_delete', err);
      }
      return;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('notifications.permissionDenied'));
    }
  };

  const labelOf = (name_i18n: { it: string; en: string }) =>
    name_i18n[lng as 'it' | 'en'] ?? name_i18n.en;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.notifications') }} />
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
        <Text className="text-text-primary">{t('onboarding.notifications.enable')}</Text>
        <Switch onValueChange={onPushToggle} />
      </View>
      {topicsPending || subsPending ? (
        <Text className="text-text-secondary text-center py-6">{t('common.loading')}</Text>
      ) : (
        <FlatList
          data={topics ?? []}
          keyExtractor={(tp) => tp.id}
          renderItem={({ item }) => {
            const checked = subscribed.includes(item.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={labelOf(item.name_i18n)}
                onPress={() => toggleTopic(item.id)}
                className={`flex-row items-center justify-between px-4 py-3 border-b border-border ${
                  checked ? 'bg-surface' : 'bg-bg'
                }`}
              >
                <Text className="text-text-primary">{labelOf(item.name_i18n)}</Text>
                <Text className={`text-lg ${checked ? 'text-primary' : 'text-text-secondary'}`}>
                  {checked ? '☑' : '☐'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
