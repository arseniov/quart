import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useIssue } from '@/api/hooks/useIssue';
import { IssueTimeline } from '@/components/issue/IssueTimeline';
import { SafeMarkdown } from '@/components/Markdown';

const STATUS_LABEL: Record<string, string> = {
  open: 'issue.status.open',
  acknowledged: 'issue.status.acknowledged',
  in_progress: 'issue.status.in_progress',
  resolved: 'issue.status.resolved',
  closed: 'issue.status.closed',
  rejected: 'issue.status.rejected',
};

export default function IssueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  if (!id) return null;
  const { data, isPending, isError, refetch } = useIssue(id);

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('issue.detail.title') }} />
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
        <ScrollView className="flex-1">
          <View className="p-4">
            <View className="self-start bg-info/10 px-2 py-1 rounded mb-3">
              <Text className="text-info text-xs">{t(STATUS_LABEL[data.issue.status] ?? data.issue.status)}</Text>
            </View>
            <View className="mb-3">
              {/* ponytail: description body rendered through XSS-safe markdown pipeline */}
              <SafeMarkdown source={data.issue.description ?? ''} />
            </View>
            {data.issue.photo_urls.length > 0 && (
              <ScrollView horizontal className="mb-4">
                {data.issue.photo_urls.map((url) => (
                  <Image key={url} source={{ uri: url }} style={{ width: 200, height: 200, borderRadius: 8, marginRight: 8 }} />
                ))}
              </ScrollView>
            )}
            <IssueTimeline events={data.events} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}
