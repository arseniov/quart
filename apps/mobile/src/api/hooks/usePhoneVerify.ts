// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → returns the Quart user projection only. The
// GH #30 JWT-mint path was deleted by GH #45 (BA owns the bearer), so
// this endpoint no longer issues tokens. The user projection drives the
// `useMe` cache; the BA session itself is currently NOT persisted from
// this flow (mobile re-signs in via /login or /signup if needed).
//
// GH #46 follow-up: thread BA's session cookie through /auth/phone/verify
// (the server-side handler can mirror BA's Set-Cookie on the response).
// Until that lands, this hook is a no-op for token storage.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
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
      // ponytail: GH #46 — BA session token storage is not wired here yet.
      //        The BA cookie (if any) is ignored; the user is treated as
      //        "no session" until a follow-up lands.
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