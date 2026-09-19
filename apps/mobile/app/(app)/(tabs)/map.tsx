// app/(app)/(tabs)/map.tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useMapMarkers } from '@/api/hooks/useMapMarkers';
import { useMe } from '@/api/hooks/useMe';
import { IssueMap } from '@/components/issue/IssueMap';
import { MapEmptyState } from '@/components/issue/MapEmptyState';

export default function MapScreen() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data, isPending, isError, refetch } = useMapMarkers(me?.city_id);

  const needsOnboarding = !!me && (me.needs_onboarding || !me.city_id);
  useEffect(() => {
    if (needsOnboarding) router.replace('/onboarding/city');
  }, [needsOnboarding]);

  if (needsOnboarding) return null;

  return (
    <View className="flex-1 bg-bg">
      {isError ? (
        <View className="flex-1 px-4 py-12 items-center justify-center">
          <Text className="text-text-secondary text-center mb-3">
            {t('errors.network')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => refetch()}
            className="bg-primary px-4 py-2 rounded-md"
          >
            <Text className="text-text-onPrimary font-semibold">
              {t('common.retry')}
            </Text>
          </Pressable>
        </View>
      ) : isPending || !me?.city_id ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (data ?? []).length === 0 ? (
        <MapEmptyState />
      ) : (
        <IssueMap markers={data ?? []} />
      )}
    </View>
  );
}
