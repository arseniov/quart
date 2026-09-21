// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → the server returns the Quart user projection
// AND forwards BA's Set-Cookie (GH #48 — see phone-otp.controller.ts). The
// helper in ba-session.ts extracts the cookie and persists it via
// saveTokens; if the server omitted the cookie (phone-only Quart user with
// no BA account — the mint path returns null), the helper throws
// `auth.no_session` so the screen can surface a "re-sign in via email or
// social" fallback instead of silently leaving the bearer token empty.
import { useMutation } from '@tanstack/react-query';
import { persistBaSessionFromResponse } from '@/api/ba-session';
import { apiClient } from '@/api/client';
import { useRegisterDevice } from '@/api/hooks/useRegisterDevice';
import { deviceFingerprint } from '@/lib/device-fingerprint';
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
      await persistBaSessionFromResponse(r.headers, 'phone_verify', register);
      return r.data;
    },
  });
}
