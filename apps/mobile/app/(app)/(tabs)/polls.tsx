import { useTranslation } from 'react-i18next';
import { FlatList, Text, RefreshControl } from 'react-native';
import { useFeed } from '@/api/hooks/useFeed';
import { PollCard } from '@/components/poll/PollCard';

export default function PollsTab() {
  const { t } = useTranslation();
  const { data, refetch, isRefetching } = useFeed({ kind: 'poll' });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <FlatList
      className="bg-bg flex-1"
      data={items}
      keyExtractor={(i) => `poll-${i.id}`}
      renderItem={({ item }) => <PollCard poll={{
        id: item.id,
        city_id: item.city_id,
        title: item.title,
        body: null,
        closes_at: new Date(Date.now() + 86400000).toISOString(),
        user_voted_option_id: null,
        options: [],
      }} />}
      ListEmptyComponent={<Text className="text-text-secondary text-center py-12">{t('feed.empty')}</Text>}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#D44E15" />}
    />
  );
}