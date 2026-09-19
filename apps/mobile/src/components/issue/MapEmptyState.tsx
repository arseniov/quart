// src/components/issue/MapEmptyState.tsx
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { minHitSlop } from '@/a11y/hit-slop';

export function MapEmptyState() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View className="flex-1 px-6 items-center justify-center bg-bg">
      <View className="bg-surface border border-border rounded-md p-lg w-full max-w-sm">
        <Text className="text-text-primary text-lg font-semibold text-center mb-2">
          {t('map.empty.title')}
        </Text>
        <Text className="text-text-secondary text-sm text-center mb-lg">
          {t('map.empty.subtitle')}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.empty.flagAction')}
          hitSlop={minHitSlop()}
          onPress={() => router.push('/issue/new')}
          className="bg-primary rounded-md p-3 items-center mb-3"
        >
          <Text className="text-text-onPrimary font-semibold">
            {t('map.empty.flagAction')}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.empty.browseFeed')}
          hitSlop={minHitSlop()}
          onPress={() => router.push('/')}
          className="border border-border rounded-md p-3 items-center"
        >
          <Text className="text-text-primary">{t('map.empty.browseFeed')}</Text>
        </Pressable>
      </View>
    </View>
  );
}