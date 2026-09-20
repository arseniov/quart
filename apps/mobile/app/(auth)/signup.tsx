// app/(auth)/signup.tsx
// GH #35: email + password sign-up form. Mirrors login.tsx — RHF + zod +
// Controller, with the email/password form rendered BELOW the Apple + Google
// social buttons (which already existed for the OAuth-only flow). On submit
// the new useSignup hook POSTs to /auth/sign-up and routes to / on success.
import { zodResolver } from '@hookform/resolvers/zod';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform, Alert } from 'react-native';

import { useSignup, SignupSchema, type SignupInput } from '@/api/hooks/useSignup';
import { useSocialLogin } from '@/api/hooks/useSocialLogin';
import { SocialButton } from '@/components/auth/SocialButton';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '@/lib/env';

// ponytail: same singleton-config pattern as login.tsx — GoogleSignin is a
//        process-wide singleton, so duplicate the configure() here rather
//        than hoist a layout hook for the second caller.
function useGoogleConfigure() {
  useEffect(() => {
    if (!GOOGLE_WEB_CLIENT_ID) return;
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    });
  }, []);
}

export default function SignupScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  useGoogleConfigure();
  const signup = useSignup();
  const socialLogin = useSocialLogin();
  const { control, handleSubmit, formState: { errors } } = useForm<SignupInput>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { email: '', password: '', display_name: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (signup.isPending || socialLogin.isPending) return;
    try {
      await signup.mutateAsync(data);
      router.replace('/');
    } catch (e: unknown) {
      // ponytail: 401/422 from the API carry a `code`+`message`; surface the
      //        message via Alert so the user sees something actionable. Real
      //        field-level zod errors are already shown inline.
      const apiMessage = (e as { data?: { message?: string }, message?: string })?.data?.message
        ?? (e as { message?: string })?.message;
      Alert.alert(apiMessage ?? t('errors.generic'));
    }
  });

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

  const onGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = (userInfo as { idToken?: string }).idToken;
      if (!idToken) throw new Error('no id token');
      await socialLogin.mutateAsync({ provider: 'google', idToken });
      router.replace('/');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === 'SIGN_IN_CANCELLED' || code === '-5') return;
      Alert.alert(t('auth.googleFailed'));
    }
  };

  const showApple = Platform.OS === 'ios';
  const pending = signup.isPending || socialLogin.isPending;

  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-6">{t('auth.signup.title')}</Text>

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            accessibilityLabel={t('auth.signup.email')}
            placeholder={t('auth.signup.email')}
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
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            accessibilityLabel={t('auth.signup.password')}
            placeholder={t('auth.signup.password')}
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

      <Controller
        control={control}
        name="display_name"
        render={({ field }) => (
          <TextInput
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            accessibilityLabel={t('auth.signup.displayName')}
            placeholder={t('auth.signup.displayNamePlaceholder')}
            className="border border-border rounded-md p-3 mb-1 text-text-primary bg-surface"
          />
        )}
      />
      {errors.display_name && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {errors.display_name.message}
        </Text>
      )}

      {signup.isError && (
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
          <Text className="text-text-onPrimary font-semibold">{t('auth.signup.submit')}</Text>
        )}
      </Pressable>

      <View className="flex-row items-center mt-6">
        <View className="flex-1 border-t border-border" />
        <Text className="text-text-secondary px-3">{t('auth.or')}</Text>
        <View className="flex-1 border-t border-border" />
      </View>

      {showApple && (
        <SocialButton
          provider="apple"
          label={t('auth.signupWithApple')}
          onPress={onApple}
          disabled={pending}
        />
      )}
      <SocialButton
        provider="google"
        label={t('auth.signupWithGoogle')}
        onPress={onGoogle}
        disabled={pending}
      />
    </View>
  );
}