// app/(auth)/signup.tsx
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function SignupScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl">{t('auth.signup.title')}</Text>
    </View>
  );
}