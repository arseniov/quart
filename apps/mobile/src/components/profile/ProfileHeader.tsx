// src/components/profile/ProfileHeader.tsx
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useMe } from '@/api/hooks/useMe';
import { Avatar } from '@/components/ui/Avatar';

export function ProfileHeader() {
  const { t } = useTranslation();
  const { data: me, isPending, isError, refetch } = useMe();

  if (isPending) {
    return (
      <View className="flex-row items-center p-4" accessibilityLabel={t('common.loading')}>
        <View className="w-16 h-16 rounded-full bg-border mr-3" />
        <View className="flex-1">
          <View className="h-4 w-32 bg-border rounded mb-2" />
          <View className="h-3 w-20 bg-border rounded" />
        </View>
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="p-4 items-center">
        <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => refetch()}
          className="bg-primary px-4 py-2 rounded-md"
        >
          <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!me) return null;

  return (
    <View className="flex-row items-center p-4 border-b border-border">
      <Avatar uri={me.avatar_url} name={me.display_name} />
      <View className="ml-3 flex-1">
        <Text className="text-text-primary text-lg font-semibold">{me.display_name}</Text>
        <Text className="text-text-secondary">@{me.handle}</Text>
      </View>
    </View>
  );
}
