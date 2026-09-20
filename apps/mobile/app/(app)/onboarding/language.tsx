// app/(app)/onboarding/language.tsx
// Step 4 of 5 (between topics and notifications-prompt).
// Deviations from a "canonical" onboarding step:
//   1. stores/onboarding.ts is NOT touched — wizard state lives in the Stack.Screen registration, no separate store needed (YAGNI).
//   2. No useUpdateMe PATCH here — notifications-prompt sends preferred_locale atomically via useCompleteOnboarding at wizard completion, so a per-tap PATCH would be redundant + a race risk. MMKV write below is crash safety only (a half-completed wizard still picks up the locale on next launch).
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import i18n, { supportedLngs, type SupportedLng } from '@/i18n';
import { mmkvStorage } from '@/lib/storage';
import { ProgressBar } from '@/components/ProgressBar';

const LABELS: Record<SupportedLng, string> = {
  it: 'Italiano',
  en: 'English',
};

export default function OnboardingLanguage() {
  const { t } = useTranslation();
  const router = useRouter();
  const current = i18n.language as SupportedLng;

  const onSelect = (lng: SupportedLng) => {
    if (lng === current) return;
    void i18n.changeLanguage(lng);             // immediate UI refresh
    mmkvStorage.setItem('i18n.lng', lng);      // GH #36: persist locally so the choice survives a crash mid-wizard
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