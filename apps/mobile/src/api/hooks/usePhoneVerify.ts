// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → returns the full session shape mirroring the
// email-login contract: short-lived access JWT + 30-day refresh JWT +
// the Quart user projection. Mirrors useLogin — saves tokens, then fires
// off the device-register hook (swallowing NotificationsPermissionError).
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';
import { deviceFingerprint } from '@/lib/device-fingerprint';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';
import type { Me } from '@/api/hooks/useMe';

export interface PhoneVerifyInput {
  phoneNumber: string;
  code: string;
}

export interface PhoneVerifyResponse {
  access_token: string;
  refresh_token: string;
  refresh_expires_at: string;
  user: Me;
}

export function usePhoneVerify() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: PhoneVerifyInput): Promise<PhoneVerifyResponse> => {
      const fp = await deviceFingerprint();
      const r = await apiClient.post<PhoneVerifyResponse>(
        '/auth/phone/verify',
        { ...input, device_fingerprint: fp },
        { skipAuth: true },
      );
      await saveTokens({ accessToken: r.data.access_token, refreshToken: r.data.refresh_token });
      // ponytail: silently swallow NotificationsPermissionError — user denied notifications but
      //          sign-in must succeed; surface only real failures via throw.
      try {
        await register.mutateAsync();
      } catch (e) {
        if (!(e instanceof NotificationsPermissionError)) throw e;
      }
      return r.data;
    },
  });
}
