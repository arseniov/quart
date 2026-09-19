import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useFeed } from '@/api/hooks/useFeed';
import { FeedItem } from '@/components/feed/FeedItem';
import { FeedItemSkeleton } from '@/components/feed/FeedItemSkeleton';
import { FilterChips } from '@/components/feed/FilterChips';
import { useUiStore } from '@/stores/ui';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const feedFilter = useUiStore((s) => s.feedFilter);
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useFeed(feedFilter === 'all' ? {} : { kind: feedFilter });

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl">{t('feed.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('issue.new.title')}
          onPress={() => router.push('/issue/new')}
          className="bg-primary px-3 py-2 rounded-md"
        >
          <Text className="text-text-onPrimary font-semibold">+</Text>
        </Pressable>
      </View>
      <FilterChips />
      {isError ? (
        <View className="px-4 py-12 items-center">
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
        <View>
          <FeedItemSkeleton />
          <FeedItemSkeleton />
          <FeedItemSkeleton />
        </View>
      ) : (
        <FlatList
          data={data?.pages.flatMap((p) => p.items) ?? []}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={({ item }) => <FeedItem item={item} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => refetch()}
              tintColor="#D44E15"
            />
          }
          onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null
          }
          ListEmptyComponent={
            <Text className="text-text-secondary text-center py-12">{t('feed.empty')}</Text>
          }
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}
