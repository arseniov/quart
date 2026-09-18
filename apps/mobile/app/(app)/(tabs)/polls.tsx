import { useTranslation } from 'react-i18next';
import { FlatList, Text, RefreshControl, ActivityIndicator, Pressable, View } from 'react-native';
import { useFeed } from '@/api/hooks/useFeed';
import { PollCard } from '@/components/poll/PollCard';
import { FeedItemSkeleton } from '@/components/feed/FeedItemSkeleton';

export default function PollsTab() {
  const { t } = useTranslation();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError, refetch, isRefetching } = useFeed({ kind: 'poll' });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View className="flex-1 bg-bg">
      {isError ? (
        <View className="px-4 py-12 items-center">
          <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()} className="bg-primary px-4 py-2 rounded-md">
            <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : isPending ? (
        <View>
          <FeedItemSkeleton />
          <FeedItemSkeleton />
          <FeedItemSkeleton />
        </View>
      ) : (
        <FlatList
          className="bg-bg flex-1"
          data={items}
          keyExtractor={(i) => `poll-${i.id}`}
          renderItem={({ item }) => <PollCard poll={{
            id: item.id,
            city_id: item.city_id,
            title: item.title,
            user_voted_option_id: null,
            options: [],
            closes_at: '',
          }} />}
          ListEmptyComponent={<Text className="text-text-secondary text-center py-12">{t('feed.empty')}</Text>}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#D44E15" />}
          onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}