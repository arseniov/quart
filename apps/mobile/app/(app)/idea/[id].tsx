import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, Pressable, FlatList } from 'react-native';
import { useIdea, useUpvoteIdea } from '@/api/hooks/useIdea';

export default function IdeaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  if (!id) return null;
  const { data, isPending, isError, refetch } = useIdea(id);
  const upvote = useUpvoteIdea(id);

  if (isError) {
    return (
      <View className="flex-1 bg-bg p-4 items-center justify-center">
        <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
        <Pressable accessibilityRole="button" onPress={() => refetch()} className="bg-primary px-4 py-2 rounded-md">
          <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (isPending || !data) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('nav.ideas') }} />
      <FlatList
        ListHeaderComponent={
          <View className="p-4">
            <Text className="text-text-primary text-2xl font-semibold mb-2">{data.idea.title}</Text>
            <Text className="text-text-secondary text-sm mb-4">▲ {data.idea.upvotes}</Text>
            <Text className="text-text-primary mb-4">{data.idea.body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: data.idea.user_upvoted }}
              onPress={() => !data.idea.user_upvoted && upvote.mutate()}
              className={`self-start px-4 py-2 rounded-md ${data.idea.user_upvoted ? 'bg-surface border border-border' : 'bg-primary'}`}
            >
              <Text className={data.idea.user_upvoted ? 'text-text-primary' : 'text-text-onPrimary font-semibold'}>
                {t('idea.upvote')}
              </Text>
            </Pressable>
            <Text className="text-text-secondary text-sm mt-6 mb-2">
              {t('idea.comments', { count: data.comments.length })}
            </Text>
          </View>
        }
        data={data.comments}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <View className="px-4 py-2 border-b border-border">
            <Text className="text-text-secondary text-xs">@{item.author_handle}</Text>
            <Text className="text-text-primary">{item.body}</Text>
          </View>
        )}
      />
    </View>
  );
}
