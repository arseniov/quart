// app/(auth)/login.tsx
import { Link, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useEffect } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';
import { useLogin, LoginSchema, type LoginInput } from '@/api/hooks/useLogin';
import { useSocialLogin } from '@/api/hooks/useSocialLogin';
import { SocialButton } from '@/components/auth/SocialButton';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '@/lib/env';

// ponytail: configure Google once on first mount — library is a singleton, so subsequent
//        navigations share the same config. Real client IDs arrive via app.config extras.
//        Android client id is injected at build via google-services.json (config plugin),
//        not via configure() — see @react-native-google-signin/google-signin docs.
function useGoogleConfigure() {
  useEffect(() => {
    if (!GOOGLE_WEB_CLIENT_ID) return; // skip in dev without secrets
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    });
  }, []);
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  useGoogleConfigure();
  const login = useLogin();
  const socialLogin = useSocialLogin();
  const { control, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (login.isPending || socialLogin.isPending) return;
    try {
      await login.mutateAsync(data);
      router.replace('/');
    } catch {
      // error surfaced via login.error below
    }
  });

  // ponytail: Apple user-cancel is ERR_CANCELED — silent (no Alert); any other error is real.
  const onApple = async () => {
    if (Platform.OS !== 'ios') return;
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) throw new Error('no identity token');
      await socialLogin.mutateAsync({
        provider: 'apple',
        idToken: cred.identityToken,
        userId: cred.user,
      });
      router.replace('/');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'ERR_CANCELED' || code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert(t('errors.generic'));
    }
  };

  // ponytail: Google has no silent-cancel convention; library surfaces SIGN_IN_CANCELLED
  //        via the same PlayServices-style status codes — treat any failure as user-visible.
  const onGoogle = async () => {
    try {
      // SIGN_IN_CANCELLED is exposed as a numeric status from the underlying native lib
      // and surfaces as a thrown error with code 'SIGN_IN_CANCELLED'.
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = (userInfo as { idToken?: string }).idToken;
      if (!idToken) throw new Error('no id token');
      await socialLogin.mutateAsync({ provider: 'google', idToken });
      router.replace('/');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'SIGN_IN_CANCELLED' || code === '-5') return; // silent cancel
      Alert.alert(t('auth.googleFailed'));
    }
  };

  const showApple = Platform.OS === 'ios';
  const pending = login.isPending || socialLogin.isPending;

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
        disabled={pending}
        className="bg-primary rounded-md p-3 items-center"
      >
        {pending ? <ActivityIndicator color="#fff" /> : (
          <Text className="text-text-onPrimary font-semibold">{t('auth.login.submit')}</Text>
        )}
      </Pressable>

      <Pressable accessibilityRole="link" onPress={() => router.push('/phone-otp')} className="mt-4">
        <Text className="text-primary text-center">{t('auth.login.orPhone')}</Text>
      </Pressable>

      <View className="flex-row items-center mt-6">
        <View className="flex-1 border-t border-border" />
        <Text className="text-text-secondary px-3">{t('auth.or')}</Text>
        <View className="flex-1 border-t border-border" />
      </View>

      {showApple && (
        <SocialButton
          provider="apple"
          label={t('auth.signinWithApple')}
          onPress={onApple}
          disabled={pending}
        />
      )}
      <SocialButton
        provider="google"
        label={t('auth.signinWithGoogle')}
        onPress={onGoogle}
        disabled={pending}
      />

      <View className="flex-row justify-center mt-4">
        <Text className="text-text-secondary">{t('auth.login.noAccount')}</Text>
        <Link href="/signup" className="ml-2 text-primary">
          {t('auth.login.signup')}
        </Link>
      </View>
    </View>
  );
}