// app/(app)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useMe } from '@/api/hooks/useMe';

export default function AppLayout() {
  const { data: me, isPending } = useMe();

  if (isPending) return null; // splash handles pending
  if (!me) return <Redirect href="/login" />;
  if (me.needs_onboarding) return <Redirect href="/onboarding/city" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding/city" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/neighborhood" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/topics" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/notifications-prompt" options={{ headerShown: true }} />
      <Stack.Screen name="issue/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="issue/[id]" />
      <Stack.Screen name="idea/[id]" />
      <Stack.Screen name="poll/[id]" />
      <Stack.Screen name="user/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="search" />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/account" />
      <Stack.Screen name="settings/notifications" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/privacy" />
      <Stack.Screen name="settings/about" />
    </Stack>
  );
}