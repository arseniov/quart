// src/api/hooks/usePhoneStart.ts
// Triggers an OTP SMS via POST /auth/phone/start. Backend is idempotent —
// retrying the same phone within the cooldown window returns the same result
// without sending a duplicate SMS.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface PhoneStartInput {
  phone: string;
}

export function usePhoneStart() {
  return useMutation({
    mutationFn: async (input: PhoneStartInput) => {
      await apiClient.post('/auth/phone/start', input, { skipAuth: true });
    },
  });
}
