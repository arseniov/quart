import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator } from 'react-native';
import { usePoll } from '@/api/hooks/usePoll';
import { PollVoteSheet } from '@/components/poll/PollVoteSheet';

export default function PollDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  if (!id) return null;
  const { data: poll, isPending } = usePoll(id);

  return (
    <View className="flex-1 bg-bg p-4">
      <Stack.Screen options={{ title: t('nav.polls') }} />
      {isPending || !poll ? (
        <ActivityIndicator />
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