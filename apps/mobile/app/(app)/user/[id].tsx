import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, ScrollView, Pressable, Image } from 'react-native';

import { useUser } from '@/api/hooks/useUser';

/**
 * Public profile screen — `app/(app)/user/[id].tsx`. Reached by:
 *   - author bylines (future — see `CommentList` byline refactor)
 *   - deep link `/user/{id}` from notification payloads
 *
 * Reads `GET /users/:id` and renders the sanitized DTO. 404/410 are
 * surfaced distinctly: 404 → "not found", 410 → "deleted" — never
 * conflated, so broken deep-links can be diagnosed by their cause.
 */
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();

  const { data, isPending, isError, error, refetch } = useUser(id);

  if (!id) return null;

  const errorKey = isError
    ? error?.status === 410
      ? 'user.profile.deleted'
      : 'user.profile.notFound'
    : null;

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('user.profile.title'), headerShown: true }} />
      {isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : errorKey ? (
        <View className="flex-1 p-4 items-center justify-center">
          <Text className="text-text-secondary text-center mb-3">{t(errorKey)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
            onPress={() => refetch()}
            className="bg-primary px-4 py-2 rounded-md"
          >
            <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView className="flex-1">
          <View className="p-4 items-center">
            {data.avatarUrl ? (
              <Image
                source={{ uri: data.avatarUrl }}
                style={{ width: 96, height: 96, borderRadius: 48, marginBottom: 12 }}
                accessibilityLabel={data.displayName}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View
                style={{ width: 96, height: 96, borderRadius: 48, marginBottom: 12 }}
                className="bg-surface items-center justify-center"
              >
                <Text className="text-text-secondary text-2xl">
                  {data.displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text className="text-text-primary text-xl font-semibold">{data.displayName}</Text>
            <Text className="text-text-secondary text-sm mb-2">
              {t('user.profile.handle', { handle: data.handle })}
            </Text>
            <Text className="text-text-secondary text-xs">
              {t('user.profile.joinedAt', { date: new Date(data.joinedAt).toLocaleDateString(i18n.language) })}
            </Text>
          </View>

          <View className="px-4 pb-6">
            <Text className="text-text-primary text-sm font-semibold mb-3">
              {t('user.profile.statsTitle')}
            </Text>
            <View className="flex-row justify-between bg-surface rounded-md p-4">
              <Stat label={t('user.profile.ideasCount')} value={data.publicStats.ideasCount} />
              <Stat label={t('user.profile.issuesCount')} value={data.publicStats.issuesCount} />
              <Stat label={t('user.profile.pollsCount')} value={data.publicStats.pollsCount} />
            </View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View className="items-center flex-1">
      <Text className="text-text-primary text-lg font-semibold">{value}</Text>
      <Text className="text-text-secondary text-xs">{label}</Text>
    </View>
  );
}
