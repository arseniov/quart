import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg items-center justify-center">
      <Text className="text-text-primary text-xl">{t('feed.title')}</Text>
    </View>
  );
}