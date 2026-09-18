// src/api/hooks/useRegisterDevice.ts
import * as Notifications from 'expo-notifications';
import { useMutation } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { apiClient } from '@/api/client';
import { EAS_PROJECT_ID } from '@/lib/env';

export function useRegisterDevice() {
  return useMutation({
    mutationFn: async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') return null;
      const token = await Notifications.getExpoPushTokenAsync(
        EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : {},
      );
      await apiClient.post('/me/devices', {
        expo_push_token: token.data,
        locale: 'it',
        device_platform: Platform.OS,
        app_version: '0.0.1',
      });
      return token.data;
    },
  });
}
