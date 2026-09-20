// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → the server returns the Quart user projection
// AND forwards BA's Set-Cookie (GH #48 — see phone-otp.controller.ts). We
// extract the cookie value via extractBaSessionToken and persist it via
// saveTokens; if the server omitted the cookie (phone-only Quart user with
// no BA account — the mint path returns null), we throw `auth.no_session`
// so the screen can surface a "re-sign in via email or social" fallback
// instead of silently leaving the bearer token empty.
import { useMutation } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/api/client';
import { extractBaSessionToken } from '@/api/ba-cookie';
import { deviceFingerprint } from '@/lib/device-fingerprint';
import { saveTokens } from '@/lib/auth';
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
      const baSessionToken = extractBaSessionToken(r.headers);
      if (!baSessionToken) {
        throw new ApiError(500, 'auth.no_session', 'no session cookie in phone-verify response');
      }
      saveTokens({ baSessionToken });
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