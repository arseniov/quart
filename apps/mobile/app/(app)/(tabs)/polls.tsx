import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function PollsScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg items-center justify-center">
      <Text className="text-text-primary text-xl">{t('nav.polls')}</Text>
    </View>
  );
}