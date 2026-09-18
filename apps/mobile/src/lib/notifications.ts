// src/lib/notifications.ts
import { Platform } from 'react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { tokens } from '@/theme/tokens';

export interface NotificationPayload {
  kind: string;
  target_id: string | null;
  locale?: string;
}

// ponytail: 3rd-party payloads are untrusted (Expo transport); fall through to inbox for any
//          unknown kind or missing target. Tighten kinds via shared-types once Expo typings ship.
export function routeForNotification(p: NotificationPayload): string {
  if (p.kind === 'idea' && p.target_id) return `/idea/${p.target_id}`;
  if (p.kind === 'poll' && p.target_id) return `/poll/${p.target_id}`;
  if (p.kind === 'issue' && p.target_id) return `/issue/${p.target_id}`;
  return '/notifications';
}

type ListenerSub = ReturnType<typeof Notifications.addNotificationResponseReceivedListener>;

// ponytail: returns EventSubscription so callers in non-root positions can dispose. At app root the
//          effect runs once; document lifetime and refactor only when a second registration appears.
export function configureNotificationHandler(): ListenerSub | undefined {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const payload = response.notification.request.content.data as unknown as NotificationPayload;
    router.push(routeForNotification(payload));
  });
  return sub;
}

// ponytail: channel names hardcoded English — OS renders them in system notification shade and
//          translation at registration time is unreliable (i18n.locale can change after boot).
export function configureAndroidChannels(): void {
  if (Platform.OS !== 'android') return;
  Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: tokens.color.primary.light,
  });
  Notifications.setNotificationChannelAsync('poll', {
    name: 'Polls',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: tokens.color.info,
  });
  Notifications.setNotificationChannelAsync('issue', {
    name: 'Issues',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: tokens.color.error,
  });
}
