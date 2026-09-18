// app/(app)/onboarding/neighborhood.tsx
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { apiClient } from '@/api/client';
import { useOnboardingStore } from '@/stores/onboarding';
import { ProgressBar } from '@/components/ProgressBar';

export default function OnboardingNeighborhood() {
  const { t } = useTranslation();
  const router = useRouter();
  const city = useOnboardingStore((s) => s.city);
  const setNeighborhood = useOnboardingStore((s) => s.setNeighborhood);

  const { data, isPending } = useQuery({
    queryKey: ['neighborhoods', city],
    queryFn: async () => {
      if (!city) return [];
      const r = await apiClient.get<{ neighborhoods: Array<{ id: string; name: string }> }>(
        `/cities/${city}/neighborhoods`,
      );
      return r.data.neighborhoods;
    },
    enabled: !!city,
  });

  return (
    <View className="flex-1 bg-bg">
      <ProgressBar current={2} total={4} />
      <Text className="text-text-primary text-2xl px-4 mb-4">{t('onboarding.neighborhood.title')}</Text>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNeighborhood(item.id);
                router.push('/onboarding/topics');
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