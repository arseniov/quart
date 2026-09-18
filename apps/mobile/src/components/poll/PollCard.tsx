import { Link } from 'expo-router';
import { View, Text, Pressable } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useTranslation } from 'react-i18next';
import type { Poll } from '@/api/hooks/usePoll';
import i18n from '@/i18n';

type PollCardProps = {
  poll: Pick<Poll, 'id' | 'title' | 'city_id'> & {
    body?: Poll['body'];
    user_voted_option_id?: Poll['user_voted_option_id'];
    options?: Poll['options'];
    closes_at?: Poll['closes_at'];
  };
};

export function PollCard({ poll }: PollCardProps) {
  const { t } = useTranslation();
  const options = poll.options ?? [];
  const total = options.reduce((s, o) => s + o.votes, 0);
  const voted = poll.user_voted_option_id !== null && poll.user_voted_option_id !== undefined;
  const closes = poll.closes_at ? new Date(poll.closes_at).toLocaleDateString(i18n.language) : '';

  return (
    <Link href={`/poll/${poll.id}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Poll: ${poll.title}`}>
        <Card className="m-3">
          <Text className="text-text-primary text-base font-semibold mb-2">{poll.title}</Text>
          {total > 0 && closes && (
            <Text className="text-text-secondary text-xs mb-3">
              {t('poll.totalVotes', { count: total })} • {t('poll.closesAt', { date: closes })}
            </Text>
          )}
          {voted && (
            <View className="self-start bg-primary/10 px-2 py-1 rounded">
              <Text className="text-primary text-xs">{t('poll.voted')}</Text>
            </View>
          )}
        </Card>
      </Pressable>
    </Link>
  );
}