import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useNotifications, useMarkNotificationRead } from '@/api/hooks/useNotifications';

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch, isRefetching } = useNotifications();
  const markRead = useMarkNotificationRead();

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('notifications.title'), headerShown: true }} />
      {isError ? (
        <View className="flex-1 p-4 items-center justify-center">
          <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => refetch()}
            className="bg-primary px-4 py-2 rounded-md"
          >
            <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={
            <Text className="text-text-secondary text-center py-12">{t('notifications.empty')}</Text>
          }
          renderItem={({ item }) => {
            // ponytail: typedRoutes enhancement, tighten when Href type is centralized
            const target = (item.target_url ?? '/notifications') as never;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => {
                  if (!item.read_at) markRead.mutate(item.id);
                  router.push(target);
                }}
                className="px-4 py-3 border-b border-border bg-bg"
              >
                <Text
                  className={`text-base ${item.read_at ? 'text-text-secondary' : 'text-text-primary font-semibold'}`}
                >
                  {item.title}
                </Text>
                {item.body ? (
                  <Text className="text-text-secondary text-sm mt-1">{item.body}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
