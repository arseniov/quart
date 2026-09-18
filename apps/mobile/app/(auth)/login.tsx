// app/(auth)/login.tsx
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, Text, TextInput, Pressable } from 'react-native';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-6">{t('auth.login.title')}</Text>
      <TextInput
        accessibilityLabel={t('auth.login.email')}
        placeholder={t('auth.login.email')}
        className="border border-border rounded-md p-3 mb-3 text-text-primary bg-surface"
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        accessibilityLabel={t('auth.login.password')}
        placeholder={t('auth.login.password')}
        secureTextEntry
        className="border border-border rounded-md p-3 mb-6 text-text-primary bg-surface"
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        className="bg-primary rounded-md p-3 items-center"
      >
        <Text className="text-text-onPrimary font-semibold">{t('auth.login.submit')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push('/phone-otp')}
        className="mt-4"
      >
        <Text className="text-primary text-center">{t('auth.login.orPhone')}</Text>
      </Pressable>
      <View className="flex-row justify-center mt-4">
        <Text className="text-text-secondary">{t('auth.login.noAccount')}</Text>
        <Link href="/signup" className="ml-2 text-primary">
          {t('auth.login.signup')}
        </Link>
      </View>
    </View>
  );
}