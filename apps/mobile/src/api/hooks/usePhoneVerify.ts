// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → returns tokens, persists them, best-effort
// device registration (NotificationsPermissionError is swallowed).
// Mirrors useLogin.ts so success routing stays identical.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';

export interface PhoneVerifyInput {
  phone: string;
  code: string;
}

export interface PhoneVerifyResponse {
  access_token: string;
  refresh_token: string;
}

export function usePhoneVerify() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: PhoneVerifyInput): Promise<PhoneVerifyResponse> => {
      const r = await apiClient.post<PhoneVerifyResponse>(
        '/auth/phone/verify',
        input,
        { skipAuth: true },
      );
      await saveTokens({
        accessToken: r.data.access_token,
        refreshToken: r.data.refresh_token,
      });
      // ponytail: same swallow-NotificationsPermissionError pattern as useLogin —
      //        user denying notifications must not fail phone-otp login.
      try {
        await register.mutateAsync();
      } catch (e) {
        if (!(e instanceof NotificationsPermissionError)) throw e;
      }
      return r.data;
    },
  });
}
