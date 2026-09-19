// app/(app)/search.tsx
// GH #23 — full-text search across polls, ideas, and issues scoped to the
// user's city and (optional) neighborhood. Debounced 250ms to avoid firing
// a request on every keystroke. Empty state surfaces a "Suggest an idea"
// CTA that links to the existing /idea/compose screen.
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useMe } from '@/api/hooks/useMe';
import { useSearch } from '@/api/hooks/useSearch';
import type { SearchHit } from '@/api/hooks/useSearch';
import { FeedItem } from '@/components/feed/FeedItem';
import { useReduceMotion } from '@/a11y/motion';
import { minHitSlop } from '@/a11y/hit-slop';

const DEBOUNCE_MS = 250;
const SEARCH_HIT_SLOP = minHitSlop();

// The server returns a stricter `SearchHit` shape than the feed card needs
// (no `excerpt`). Map to the minimal `FeedItem` shape the card expects;
// missing fields render as empty strings, which is fine for a search list.
function toFeedItem(h: SearchHit) {
  return {
    kind: h.kind as 'poll' | 'idea' | 'issue',
    id: h.id,
    title: h.title,
    excerpt: '',
    created_at: h.createdAt,
    city_id: h.cityId,
  };
}

export default function SearchScreen() {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const { data: me } = useMe();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    if (reduceMotion) {
      setDebounced(input);
      return;
    }
    const id = setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input, reduceMotion]);

  const filters = useMemo(
    () => ({
      q: debounced,
      city_id: me?.city_id ?? undefined,
    }),
    [debounced, me?.city_id],
  );
  const { data, isPending, isError, refetch, isRefetching } = useSearch(filters);

  const items = data ?? [];
  const showInitial = debounced.length === 0;
  const showEmpty = !showInitial && !isPending && !isError && items.length === 0;

  return (
    <>
      <Stack.Screen options={{ title: t('search.title') }} />
      <View className="flex-1 bg-bg">
        <View className="px-4 pt-3 pb-2">
          <TextInput
            accessibilityLabel={t('search.inputLabel')}
            placeholder={t('search.placeholder')}
            placeholderTextColor="#9CA3AF"
            value={input}
            onChangeText={setInput}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            className="bg-surface border border-border rounded-md px-3 py-2 text-text-primary"
          />
        </View>
        {isError ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-text-secondary text-center mb-3">{t('errors.network')}</Text>
            <Pressable
              hitSlop={SEARCH_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('common.retry')}
              onPress={() => refetch()}
              className="bg-primary px-4 py-2 rounded-md"
            >
              <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : showInitial ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-text-secondary text-center">{t('search.prompt')}</Text>
          </View>
        ) : isPending ? (
          <ActivityIndicator className="mt-12" />
        ) : showEmpty ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-text-secondary text-center mb-4">{t('search.empty', { q: debounced })}</Text>
            <Pressable
              hitSlop={SEARCH_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('search.suggestIdea')}
              onPress={() => router.push('/idea/compose')}
              className="bg-primary px-4 py-2 rounded-md"
            >
              <Text className="text-text-onPrimary font-semibold">
                {t('search.suggestIdea')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={items.map(toFeedItem)}
            keyExtractor={(item) => `${item.kind}-${item.id}`}
            renderItem={({ item }) => <FeedItem item={item} />}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                tintColor="#D44E15"
              />
            }
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>
    </>
  );
}
