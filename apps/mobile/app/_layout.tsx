// app/_layout.tsx
import '../global.css';
import '../src/i18n';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
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

initSentry();

export default function RootLayout() {
  const scheme = useColorScheme();

  useEffect(() => {
    const sub = configureNotificationHandler();
    configureAndroidChannels();
    // ponytail: listener lives for app lifetime; refactor to root-level useEffect cleanup when needed
    return () => sub?.remove();
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
