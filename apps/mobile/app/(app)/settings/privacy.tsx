// app/(app)/settings/privacy.tsx
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { useExportData, useDeleteAccount } from '@/api/hooks/useDsar';
import { clearTokens } from '@/lib/auth';
import { PRIVACY_POLICY_URL } from '@/lib/constants';

export default function PrivacySettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const exportData = useExportData();
  const deleteAccount = useDeleteAccount();

  const onExport = () => {
    exportData.mutate(undefined, {
      onSuccess: (data) => {
        Alert.alert(t('privacy.exportRequested'), data.request_id);
      },
      onError: () => Alert.alert(t('errors.generic')),
    });
  };

  const onDelete = () => {
    Alert.alert(t('privacy.deleteConfirmTitle'), t('privacy.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteAccount'),
        style: 'destructive',
        onPress: () => {
          deleteAccount.mutate(undefined, {
            onSuccess: async () => {
              await clearTokens();
              qc.clear();
              router.replace('/login');
            },
            onError: () => Alert.alert(t('errors.generic')),
          });
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: t('settings.privacy') }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="p-4">
          <Text className="text-text-primary text-base">{t('privacy.intro')}</Text>
        </View>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('privacy.policy')}
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          className="mx-4 mb-3 bg-surface border border-border rounded-md p-3"
        >
          <Text className="text-text-primary">{t('privacy.policy')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.exportData')}
          onPress={onExport}
          disabled={exportData.isPending}
          className="mx-4 mb-3 bg-primary rounded-md p-3 items-center"
        >
          <Text className="text-text-onPrimary font-semibold">
            {exportData.isPending ? t('common.loading') : t('settings.exportData')}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteAccount')}
          onPress={onDelete}
          disabled={deleteAccount.isPending}
          className="mx-4 mb-3 bg-surface border border-error rounded-md p-3 items-center"
        >
          <Text className="text-error font-semibold">
            {deleteAccount.isPending ? t('common.loading') : t('settings.deleteAccount')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
