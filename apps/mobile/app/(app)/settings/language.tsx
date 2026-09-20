// app/(app)/settings/language.tsx
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { useMe } from '@/api/hooks/useMe';
import { useUpdateMe } from '@/api/hooks/useUpdatePrefs';
import i18n, { supportedLngs, type SupportedLng } from '@/i18n';
import { mmkvStorage } from '@/lib/storage';

const LABELS: Record<SupportedLng, string> = {
  it: 'Italiano',
  en: 'English',
};

export default function LanguageSettings() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const updateMe = useUpdateMe();

  const current = (me?.preferred_locale ?? (i18n.language as SupportedLng)) as SupportedLng;

  const onSelect = async (lng: SupportedLng) => {
    if (lng === current) return;
    // GH #37: capture previous locale BEFORE the optimistic swap so the catch can roll back
    // without awaiting i18n.changeLanguage (which would re-throw inside the catch).
    const previousLocale = i18n.language as SupportedLng;
    void i18n.changeLanguage(lng); // immediate UI refresh
    try {
      await updateMe.mutateAsync({ preferred_locale: lng });
      mmkvStorage.setItem('i18n.lng', lng); // next cold launch picks up the new locale
    } catch (err) {
      void i18n.changeLanguage(previousLocale);
      Alert.alert(t('errors.generic'), String((err as Error).message));
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.language') }} />
      <FlatList
        data={[...supportedLngs]}
        keyExtractor={(lng) => lng}
        renderItem={({ item }) => {
          const selected = item === current;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={LABELS[item]}
              onPress={() => void onSelect(item)}
              className={`flex-row items-center justify-between px-4 py-3 border-b border-border ${
                selected ? 'bg-surface' : 'bg-bg'
              }`}
            >
              <Text className="text-text-primary">{LABELS[item]}</Text>
              {selected ? <Text className="text-primary text-lg">✓</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
