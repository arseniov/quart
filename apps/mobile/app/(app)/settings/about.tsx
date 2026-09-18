// app/(app)/settings/about.tsx
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export default function AboutScreen() {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version ?? 'unknown';
  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.about') }} />
      <View className="p-4">
        <View className="py-3 border-b border-border">
          <Text className="text-text-secondary text-xs uppercase mb-1">{t('about.version')}</Text>
          <Text className="text-text-primary">{version}</Text>
        </View>
        <View className="py-3 border-b border-border">
          <Text className="text-text-secondary text-xs uppercase mb-1">{t('about.copyright')}</Text>
          <Text className="text-text-primary">© {new Date().getFullYear()} Quart</Text>
        </View>
      </View>
    </View>
  );
}
