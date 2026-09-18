import { useTranslation } from 'react-i18next';
import { FlatList, Text, RefreshControl, ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFeed } from '@/api/hooks/useFeed';
import { IdeaCard } from '@/components/idea/IdeaCard';
import { FeedItemSkeleton } from '@/components/feed/FeedItemSkeleton';

export default function IdeasTab() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isError, refetch, isRefetching } = useFeed({ kind: 'idea' });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-end px-3 pt-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('idea.compose.title')}
          onPress={() => router.push('/idea/compose')}
          className="bg-primary px-3 py-2 rounded-md"
        >
          <Text className="text-text-onPrimary font-semibold">+</Text>
        </Pressable>
      </View>
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
          data={items}
          keyExtractor={(i) => `idea-${i.id}`}
          renderItem={({ item }) => <IdeaCard idea={{ id: item.id, title: item.title }} excerpt={item.excerpt} />}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#D44E15" />}
          onEndReached={() => hasNextPage && !isFetchingNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null}
          ListEmptyComponent={<Text className="text-text-secondary text-center py-12">{t('feed.empty')}</Text>}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}
