import { Link } from 'expo-router';
import { View, Text, Pressable } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useTranslation } from 'react-i18next';
import type { Poll } from '@/api/hooks/usePoll';

export function PollCard({ poll }: { poll: Poll }) {
  const { t } = useTranslation();
  const total = poll.options.reduce((s, o) => s + o.votes, 0);
  const voted = poll.user_voted_option_id !== null;
  const closes = new Date(poll.closes_at).toLocaleDateString();

  return (
    <Link href={`/poll/${poll.id}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Poll: ${poll.title}`}>
        <Card className="m-3">
          <Text className="text-text-primary text-base font-semibold mb-2">{poll.title}</Text>
          {total > 0 && (
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