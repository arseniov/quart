import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Poll } from '@/api/hooks/usePoll';
import { useVoteOnPoll } from '@/api/hooks/usePoll';

export function PollVoteSheet({ poll }: { poll: Poll }) {
  const { t } = useTranslation();
  const vote = useVoteOnPoll(poll.id);
  const voted = poll.user_voted_option_id;

  if (voted) {
    const total = poll.options.reduce((s, o) => s + o.votes, 0) || 1;
    return (
      <View>
        <Text className="text-text-primary font-semibold mb-3">{t('poll.results')}</Text>
        {poll.options.map((o) => {
          const pct = Math.round((o.votes / total) * 100);
          const isMine = o.id === voted;
          return (
            <View key={o.id} className="mb-2">
              <View className="flex-row justify-between mb-1">
                <Text className={`text-text-primary ${isMine ? 'font-semibold' : ''}`}>{o.label}</Text>
                <Text className="text-text-secondary">{pct}%</Text>
              </View>
              <View className="h-2 bg-border rounded-full overflow-hidden">
                <View className={`h-full ${isMine ? 'bg-primary' : 'bg-info'}`} style={{ width: `${pct}%` }} />
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      <Text className="text-text-primary font-semibold mb-3">{t('poll.vote')}</Text>
      {poll.options.map((o) => {
        const selected = vote.variables === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => vote.mutate(o.id)}
            disabled={vote.isPending}
            className={`border rounded-md p-3 mb-2 ${selected ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}
          >
            <Text className="text-text-primary">{o.label}</Text>
          </Pressable>
        );
      })}
      {vote.isPending && <ActivityIndicator className="mt-2" />}
      {vote.isError && (
        <Text accessibilityLiveRegion="polite" className="text-error mt-2">
          {t('errors.generic')}
        </Text>
      )}
    </View>
  );
}