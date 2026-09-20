// src/api/hooks/usePhoneStart.ts
// POST /auth/phone/request — kicks off the OTP SMS via the API. The body uses
// `phoneNumber` (E.164) to match the controller's zod schema; response is
// `{ ok: true }`, no tokens here. Caller surfaces nothing user-visible.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface PhoneStartInput {
  phoneNumber: string;
}

export function usePhoneStart() {
  return useMutation({
    mutationFn: async (input: PhoneStartInput) => {
      await apiClient.post('/auth/phone/request', input, { skipAuth: true });
    },
  });
}