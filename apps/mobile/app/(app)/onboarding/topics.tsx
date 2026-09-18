// app/(app)/onboarding/topics.tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useTopics } from '@/api/hooks/useTopics';
import { useOnboardingStore } from '@/stores/onboarding';
import { ProgressBar } from '@/components/ProgressBar';

export default function OnboardingTopics() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isPending } = useTopics();
  const topic_ids = useOnboardingStore((s) => s.topic_ids);
  const toggleTopic = useOnboardingStore((s) => s.toggleTopic);

  return (
    <View className="flex-1 bg-bg">
      <ProgressBar current={3} total={4} />
      <Text className="text-text-primary text-2xl px-4 mb-4">{t('onboarding.topics.title')}</Text>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(tp) => tp.id}
          renderItem={({ item }) => {
            const selected = topic_ids.includes(item.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggleTopic(item.id)}
                className={`mx-4 my-1 p-3 rounded-md border ${selected ? 'bg-primary border-primary' : 'border-border bg-surface'}`}
              >
                <Text className={selected ? 'text-text-onPrimary' : 'text-text-primary'}>
                  {item.name_i18n.it}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/onboarding/notifications-prompt')}
        className="m-4 bg-primary rounded-md p-3 items-center"
      >
        <Text className="text-text-onPrimary font-semibold">{t('common.ok')}</Text>
      </Pressable>
    </View>
  );
}