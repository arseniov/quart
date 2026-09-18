// app/(app)/onboarding/notifications-prompt.tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useOnboardingStore } from '@/stores/onboarding';
import { useCompleteOnboarding } from '@/api/hooks/useCompleteOnboarding';
import { ProgressBar } from '@/components/ProgressBar';

export default function OnboardingNotificationsPrompt() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { city, neighborhood, topic_ids, notification_topics, toggleNotificationTopic } =
    useOnboardingStore();
  const complete = useCompleteOnboarding();
  const locale = i18n.language;

  const enable = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      // Mirror topics into notification_topics as default selection
      if (notification_topics.length === 0) {
        for (const id of topic_ids) toggleNotificationTopic(id);
      }
    }
    await submit();
  };

  const submit = async () => {
    try {
      await complete.mutateAsync({
        city_id: city!,
        neighborhood_id: neighborhood!,
        topic_ids,
        preferred_locale: locale,
      });
      router.replace('/');
    } catch {
      Alert.alert(t('errors.generic'));
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ProgressBar current={4} total={4} />
      <Text className="text-text-primary text-2xl px-4 mb-6">{t('onboarding.notifications.title')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={enable}
        className="mx-4 mb-3 bg-primary rounded-md p-3 items-center"
      >
        <Text className="text-text-onPrimary font-semibold">{t('onboarding.notifications.enable')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={submit} className="mx-4">
        <Text className="text-primary text-center">{t('onboarding.notifications.later')}</Text>
      </Pressable>
    </View>
  );
}