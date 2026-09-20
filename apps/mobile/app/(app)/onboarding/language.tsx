// app/(app)/onboarding/language.tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import i18n, { supportedLngs, type SupportedLng } from '@/i18n';
import { useUpdateMe } from '@/api/hooks/useUpdatePrefs';
import { mmkvStorage } from '@/lib/storage';
import { ProgressBar } from '@/components/ProgressBar';

const LABELS: Record<SupportedLng, string> = {
  it: 'Italiano',
  en: 'English',
};

export default function OnboardingLanguage() {
  const { t } = useTranslation();
  const router = useRouter();
  const updateMe = useUpdateMe();
  const current = i18n.language as SupportedLng;

  const onSelect = (lng: SupportedLng) => {
    if (lng === current) return;
    void i18n.changeLanguage(lng);             // immediate UI refresh
    mmkvStorage.setItem('i18n.lng', lng);      // GH #36: persist locally so the choice survives a crash mid-wizard
    updateMe.mutate({ preferred_locale: lng }); // persist server-side (mirrors settings/language.tsx)
    router.push('/onboarding/notifications-prompt');
  };

  return (
    <View className="flex-1 bg-bg">
      <ProgressBar current={4} total={5} />
      <Text className="text-text-primary text-2xl px-4 mb-2">{t('onboarding.language.title')}</Text>
      <Text className="text-text-secondary px-4 mb-4">{t('onboarding.language.subtitle')}</Text>
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