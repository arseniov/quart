// app/(app)/settings/language.tsx
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import i18n, { supportedLngs, type SupportedLng } from '@/i18n';
import { useMe } from '@/api/hooks/useMe';
import { useUpdateMe } from '@/api/hooks/useUpdatePrefs';

const LABELS: Record<SupportedLng, string> = {
  it: 'Italiano',
  en: 'English',
};

export default function LanguageSettings() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const updateMe = useUpdateMe();

  const current = (me?.preferred_locale ?? (i18n.language as SupportedLng)) as SupportedLng;

  const onSelect = (lng: SupportedLng) => {
    if (lng === current) return;
    void i18n.changeLanguage(lng); // immediate UI refresh; persisted on next launch via onboarding/save
    updateMe.mutate({ preferred_locale: lng });
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
              onPress={() => onSelect(item)}
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
