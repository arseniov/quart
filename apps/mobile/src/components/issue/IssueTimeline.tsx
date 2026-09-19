import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import i18n from '@/i18n';
import type { IssueEventSchema } from '@/api/hooks/useIssue';

export type IssueEvent = z.infer<typeof IssueEventSchema>;

export function IssueTimeline({ events }: { events: IssueEvent[] }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text className="text-text-primary text-lg font-semibold mb-3">{t('issue.timeline.title')}</Text>
      {events.map((e) => (
        <View key={e.id} className="flex-row mb-3">
          <View className="w-2 h-2 rounded-full bg-primary mt-2 mr-3" />
          <View className="flex-1">
            <Text className="text-text-primary">{t(`issue.event.${e.event_type}`)}</Text>
            <Text className="text-text-secondary text-xs">
              @{e.actor_handle} • {new Date(e.created_at).toLocaleString(i18n.language)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
