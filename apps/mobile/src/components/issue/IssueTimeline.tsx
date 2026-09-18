import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';

export interface IssueEvent {
  id: string;
  event_type: 'created' | 'status_changed' | 'assigned' | 'commented' | 'photo_added';
  actor_handle: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function IssueTimeline({ events }: { events: IssueEvent[] }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text className="text-text-primary text-lg font-semibold mb-3">{t('issue.timeline.title')}</Text>
      {events.map((e) => (
        <View key={e.id} className="flex-row mb-3">
          <View className="w-2 h-2 rounded-full bg-primary mt-2 mr-3" />
          <View className="flex-1">
            <Text className="text-text-primary">{e.event_type}</Text>
            <Text className="text-text-secondary text-xs">
              @{e.actor_handle} • {new Date(e.created_at).toLocaleString(i18n.language)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
