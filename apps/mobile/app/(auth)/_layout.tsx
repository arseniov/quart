// app/(auth)/_layout.tsx
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function AuthLayout() {
  const { t } = useTranslation();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: 'transparent' },
        headerTitle: t('auth.login.title'),
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="phone-otp" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}