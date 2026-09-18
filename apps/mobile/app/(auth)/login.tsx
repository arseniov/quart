// app/(auth)/login.tsx
import { Link, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useLogin, LoginSchema, type LoginInput } from '@/api/hooks/useLogin';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const login = useLogin();
  const { control, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      await login.mutateAsync(data);
      router.replace('/');
    } catch {
      // error surfaced via login.error below
    }
  });

  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-6">{t('auth.login.title')}</Text>

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            {...field}
            accessibilityLabel={t('auth.login.email')}
            placeholder={t('auth.login.email')}
            autoCapitalize="none"
            keyboardType="email-address"
            className="border border-border rounded-md p-3 mb-1 text-text-primary bg-surface"
          />
        )}
      />
      {errors.email && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {errors.email.message}
        </Text>
      )}

      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextInput
            {...field}
            accessibilityLabel={t('auth.login.password')}
            placeholder={t('auth.login.password')}
            secureTextEntry
            className="border border-border rounded-md p-3 mb-1 text-text-primary bg-surface"
          />
        )}
      />
      {errors.password && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {errors.password.message}
        </Text>
      )}

      {login.isError && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {t('errors.generic')}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={login.isPending}
        className="bg-primary rounded-md p-3 items-center"
      >
        {login.isPending ? <ActivityIndicator color="#fff" /> : (
          <Text className="text-text-onPrimary font-semibold">{t('auth.login.submit')}</Text>
        )}
      </Pressable>

      <Pressable accessibilityRole="link" onPress={() => router.push('/phone-otp')} className="mt-4">
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