// app/_layout.tsx
import '../global.css';
import '../src/i18n';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ponytail: GH #28 — Inter is the design contract (spec §1). Hold the splash
//          until the two vendored weights resolve so the first paint shows
//          Inter, not the system fallback flash.
SplashScreen.preventAutoHideAsync();

import { Announcer } from '@/a11y/Announcer';
import { PersistProvider } from '@/api/PersistProvider';
import { trySilentAppleReauth } from '@/auth/apple-silent-reauth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { startAutoFlush } from '@/lib/connectivity';
import {
  configureNotificationHandler,
  configureAndroidChannels,
} from '@/lib/notifications';
import { ensureFreeSpace } from '@/lib/tile-cache';
import { initSentry } from '@/observability/sentry';
import { useColorScheme } from '@/theme/nativewind';

initSentry();

export default function RootLayout() {
  const scheme = useColorScheme();

  // GH #28 — vendor Inter. Two keys: 'Inter' (Regular) + 'Inter-SemiBold'.
  // tailwind.config.ts overrides fontFamily.bold/semibold to point at
  // 'Inter-SemiBold' so existing className="font-semibold" usage resolves to
  // a family swap (not just a numeric fontWeight, which RN ignores for
  // custom fonts). font-sans defaults to 'Inter'.
  const [fontsLoaded, fontError] = useFonts({
    Inter: require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    const sub = configureNotificationHandler();
    configureAndroidChannels();
    // ponytail: listener lives for app lifetime; refactor to root-level useEffect cleanup when needed
    return () => sub?.remove();
  }, []);

  // ponytail: subscribe once at root so an offline→online transition anywhere in the app triggers
  //          a flush. Cleanup runs on unmount (in practice never, but it satisfies strict-mode).
  useEffect(() => {
    const stop = startAutoFlush();
    return () => stop();
  }, []);

  // ponytail: GH #22 — auto-purge disk when the app foregrounds. Mount-time + AppState 'active'
  //          keeps the cache trimmed without requiring the user to open Settings.
  useEffect(() => {
    ensureFreeSpace().catch(console.error);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ensureFreeSpace().catch(console.error);
    });
    return () => sub.remove();
  }, []);

  // ponytail: GH #24 — silent Apple re-auth on cold launch. Fire-and-forget; the helper
  //          updates the MMKV entry on success and clears it on failure so the login screen
  //          surfaces naturally if the credential is revoked.
  useEffect(() => {
    trySilentAppleReauth().catch(console.error);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <PersistProvider>
            <Announcer />
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </PersistProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
