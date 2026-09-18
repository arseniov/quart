// app/(app)/settings/notifications.tsx
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import i18n from '@/i18n';
import { useTopics } from '@/api/hooks/useTopics';
import {
  useTopicSubscriptions,
  useUpdateTopicSubscriptions,
} from '@/api/hooks/useUpdatePrefs';

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
    update.mutate(next);
  };

  const onPushToggle = async (value: boolean) => {
    if (!value) return; // ponytail: only request, never revoke (platform-agnostic); add explicit revoke in Phase 12
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('notifications.permissionDenied'));
    }
  };

  const labelOf = (name_i18n: { it?: string; en?: string }) =>
    name_i18n?.[lng as 'it' | 'en'] ?? name_i18n?.en ?? name_i18n?.it ?? '';

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
