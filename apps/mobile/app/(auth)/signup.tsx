// app/(auth)/signup.tsx
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useEffect } from 'react';
import { View, Text, Platform, Alert } from 'react-native';
import { useSocialLogin } from '@/api/hooks/useSocialLogin';
import { SocialButton } from '@/components/auth/SocialButton';
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '@/lib/env';

// ponytail: same singleton-config pattern as login.tsx — duplicate intentionally to keep
//        each screen self-contained for code-splitting. Hoist to a layout if a third caller appears.
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
  const socialLogin = useSocialLogin();

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
  const pending = socialLogin.isPending;

  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-6">{t('auth.signup.title')}</Text>

      <View className="flex-row items-center mt-2">
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