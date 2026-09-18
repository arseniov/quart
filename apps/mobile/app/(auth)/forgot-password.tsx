// app/(auth)/forgot-password.tsx
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl">{t('auth.forgotPassword.title')}</Text>
    </View>
  );
}