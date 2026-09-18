import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function OnboardingTopicsScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg p-6">
      <Text className="text-text-primary text-2xl">{t('onboarding.topics.title')}</Text>
    </View>
  );
}