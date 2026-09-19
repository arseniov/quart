import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useIdea, useUpvoteIdea } from '@/api/hooks/useIdea';
import { CommentList } from '@/components/idea/CommentList';
import { CommentComposer } from '@/components/idea/CommentComposer';

export default function IdeaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  if (!id) return null;
  const { data, isPending, isError, refetch } = useIdea(id);
  const upvote = useUpvoteIdea(id);

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('nav.ideas') }} />
      {isError ? (
        <View className="flex-1 p-4 items-center justify-center">
          <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
          <Pressable accessibilityRole="button" onPress={() => refetch()} className="bg-primary px-4 py-2 rounded-md">
            <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : isPending || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <View className="flex-1">
          <View className="p-4">
            <Text className="text-text-primary text-2xl font-semibold mb-2">{data.idea.title}</Text>
            <Text className="text-text-secondary text-sm mb-4">▲ {data.idea.upvotes}</Text>
            <Text className="text-text-primary mb-4">{data.idea.body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: data.idea.user_upvoted, disabled: data.idea.user_upvoted }}
              disabled={data.idea.user_upvoted}
              onPress={() => !data.idea.user_upvoted && upvote.mutate()}
              className={`self-start px-4 py-2 rounded-md ${data.idea.user_upvoted ? 'bg-surface border border-border' : 'bg-primary'}`}
            >
              <Text className={data.idea.user_upvoted ? 'text-text-primary' : 'text-text-onPrimary font-semibold'}>
                {t('idea.upvote')}
              </Text>
            </Pressable>
          </View>
          <CommentList ideaId={id} />
          <CommentComposer ideaId={id} />
        </View>
      )}
    </View>
  );
}
