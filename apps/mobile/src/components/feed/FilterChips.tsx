import { View, Pressable, Text, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useUiStore, type FeedFilter } from '@/stores/ui';

const FILTERS: FeedFilter[] = ['all', 'poll', 'idea', 'issue'];

export function FilterChips() {
  const { t } = useTranslation();
  const { feedFilter, setFeedFilter } = useUiStore();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-3 py-2">
      {FILTERS.map((f) => {
        const active = feedFilter === f;
        return (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => setFeedFilter(f)}
            className={`mr-2 px-3 py-1 rounded-full border ${active ? 'bg-primary border-primary' : 'border-border bg-surface'}`}
          >
            <Text className={active ? 'text-text-onPrimary' : 'text-text-primary'}>
              {t(`feed.filter.${f}`)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
