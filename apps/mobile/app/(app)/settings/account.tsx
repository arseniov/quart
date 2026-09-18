// app/(app)/settings/account.tsx
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useMe } from '@/api/hooks/useMe';

const PLACEHOLDER = '—';

export default function AccountScreen() {
  const { t } = useTranslation();
  const { data: me, isPending } = useMe();

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.account') }} />
      {isPending ? (
        <Text className="text-text-secondary text-center py-6">{t('common.loading')}</Text>
      ) : (
        <View className="p-4">
          <View className="py-3 border-b border-border">
            <Text className="text-text-secondary text-xs uppercase mb-1">{t('account.email')}</Text>
            <Text className="text-text-primary">{me?.email ?? PLACEHOLDER}</Text>
          </View>
          <View className="py-3 border-b border-border">
            <Text className="text-text-secondary text-xs uppercase mb-1">{t('account.phone')}</Text>
            <Text className="text-text-primary">{me?.phone_e164 ?? PLACEHOLDER}</Text>
          </View>
        </View>
      )}
    </View>
  );
}
