// app/_layout.tsx
import '../global.css';
import '../src/i18n';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from '@/theme/nativewind';
import { PersistProvider } from '@/api/PersistProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Announcer } from '@/a11y/Announcer';
import { initSentry } from '@/observability/sentry';
import {
  configureNotificationHandler,
  configureAndroidChannels,
} from '@/lib/notifications';
import { startAutoFlush } from '@/lib/connectivity';
import { ensureFreeSpace } from '@/lib/tile-cache';

initSentry();

export default function RootLayout() {
  const scheme = useColorScheme();

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
