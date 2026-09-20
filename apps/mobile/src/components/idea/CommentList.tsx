// src/components/idea/CommentList.tsx
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, FlatList, Pressable } from 'react-native';

import { useIdeaComments, type IdeaComment } from '@/api/hooks/useIdeaComments';
import { SafeMarkdown } from '@/components/Markdown';
import { AuthorByline } from '@/components/user/AuthorByline';
import i18n from '@/i18n';

function CommentRow({ comment }: { comment: IdeaComment }) {
  const created = new Date(comment.createdAt);
  return (
    <View className="px-4 py-3 border-b border-border">
      <View className="flex-row items-center mb-1">
        <AuthorByline userId={comment.authorUserId} />
        <Text className="text-text-secondary text-xs">
          {' • '}
          {created.toLocaleString(i18n.language)}
        </Text>
      </View>
      <SafeMarkdown source={comment.body} />
    </View>
  );
}

export function CommentList({ ideaId }: { ideaId: string | null | undefined }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useIdeaComments(ideaId ?? '');

  if (!ideaId) return null;

  if (isError) {
    return (
      <View className="p-4 items-center">
        <Text className="text-text-secondary text-center mb-3">{t('idea.comments.loading')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => refetch()}
          className="bg-primary px-4 py-2 rounded-md"
        >
          <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (isPending) {
    return (
      <View testID="comment-list-loading" className="p-4 items-center">
        <Text className="text-text-secondary mb-2">{t('idea.comments.title')}</Text>
        <ActivityIndicator />
        <Text className="text-text-secondary mt-2">{t('idea.comments.loading')}</Text>
      </View>
    );
  }

  const comments = data ?? [];
  if (comments.length === 0) {
    return (
      <View className="p-4">
        <Text className="text-text-primary text-lg font-semibold mb-2">{t('idea.comments.title')}</Text>
        <Text className="text-text-secondary">{t('idea.comments.empty')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      ListHeaderComponent={
        <Text className="text-text-primary text-lg font-semibold mb-2 px-4 pt-4">
          {t('idea.comments.title')}
        </Text>
      }
      data={comments}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => <CommentRow comment={item} />}
    />
  );
}
