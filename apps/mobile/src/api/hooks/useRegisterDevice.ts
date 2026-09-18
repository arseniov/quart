// src/api/hooks/useRegisterDevice.ts
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useMutation } from '@tanstack/react-query';
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { apiClient } from '@/api/client';
import { EAS_PROJECT_ID } from '@/lib/env';

export function useRegisterDevice() {
  return useMutation({
    mutationFn: async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new NotificationsPermissionError(status);
      }
      const token = await Notifications.getExpoPushTokenAsync(
        EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
      );
      await apiClient.post('/me/devices', {
        expo_push_token: token.data,
        locale: i18n.language ?? 'en',
        device_platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? 'unknown',
      });
      return token.data;
    },
  });
}

export class NotificationsPermissionError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`Notifications permission not granted (status: ${status})`);
    this.name = 'NotificationsPermissionError';
    this.status = status;
  }
}
