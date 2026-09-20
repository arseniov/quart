// src/api/hooks/usePhoneVerify.ts
// POST /auth/phone/verify → returns { verified: boolean }. The endpoint
// confirms the OTP code but does NOT issue session tokens — sign-in via
// phone is gated on a follow-up API change (tracked separately). The
// caller is responsible for routing the user to sign-in separately.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface PhoneVerifyInput {
  phoneNumber: string;
  code: string;
}

export interface PhoneVerifyResponse {
  verified: boolean;
}

export function usePhoneVerify() {
  return useMutation({
    mutationFn: async (input: PhoneVerifyInput): Promise<PhoneVerifyResponse> => {
      const r = await apiClient.post<PhoneVerifyResponse>(
        '/auth/phone/verify',
        input,
        { skipAuth: true },
      );
      return r.data;
    },
  });
}