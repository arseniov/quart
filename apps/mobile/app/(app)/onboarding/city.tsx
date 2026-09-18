// app/(app)/onboarding/city.tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { useState } from 'react';
import { useCities } from '@/api/hooks/useCities';
import { useOnboardingStore } from '@/stores/onboarding';
import { ProgressBar } from '@/components/ProgressBar';

export default function OnboardingCity() {
  const { t } = useTranslation();
  const { data, isPending } = useCities();
  const [query, setQuery] = useState('');
  const setCity = useOnboardingStore((s) => s.setCity);
  const router = useRouter();

  const list = (data ?? []).filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <View className="flex-1 bg-bg">
      <ProgressBar current={1} total={4} />
      <Text className="text-text-primary text-2xl px-4 mb-4">{t('onboarding.city.title')}</Text>
      <TextInput
        accessibilityLabel={t('onboarding.city.search')}
        placeholder={t('onboarding.city.search')}
        value={query}
        onChangeText={setQuery}
        className="border border-border rounded-md p-3 mx-4 mb-4 bg-surface text-text-primary"
      />
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCity(item.id);
                router.push('/onboarding/neighborhood');
              }}
              className="px-4 py-3 border-b border-border"
            >
              <Text className="text-text-primary">{item.name}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}