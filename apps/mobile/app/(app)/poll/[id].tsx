import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { usePoll } from '@/api/hooks/usePoll';
import { PollVoteSheet } from '@/components/poll/PollVoteSheet';

export default function PollDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  if (!id) return null;
  const { data: poll, isPending, isError, refetch } = usePoll(id);

  return (
    <View className="flex-1 bg-bg p-4">
      <Stack.Screen options={{ title: t('nav.polls') }} />
      {isError ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()} className="bg-primary px-4 py-2 rounded-md">
            <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : isPending || !poll ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <>
          <Text className="text-text-primary text-2xl font-semibold mb-2">{poll.title}</Text>
          {poll.body && <Text className="text-text-secondary mb-4">{poll.body}</Text>}
          <PollVoteSheet poll={poll} />
        </>
      )}
    </View>
  );
}