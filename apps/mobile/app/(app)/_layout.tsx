// app/(app)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useMe } from '@/api/hooks/useMe';

export default function AppLayout() {
  const { data: me, isPending } = useMe();

  if (isPending) return null; // ponytail: blank screen during auth bootstrap; Phase 5 wires expo-splash-screen
  if (!me) return <Redirect href="/login" />;
  if (me.needs_onboarding) return <Redirect href="/onboarding/city" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding/city" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/neighborhood" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/topics" options={{ headerShown: true }} />
      <Stack.Screen name="onboarding/notifications-prompt" options={{ headerShown: true }} />
      <Stack.Screen name="settings" />
    </Stack>
  );
}