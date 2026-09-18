// app/+not-found.tsx
import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: '404' }} />
      <View className="flex-1 items-center justify-center bg-bg p-4">
        <Text className="text-text-primary text-xl">{t('errors.generic')}</Text>
        <Link href="/" className="mt-4 text-primary">
          {t('common.back')}
        </Link>
      </View>
    </>
  );
}