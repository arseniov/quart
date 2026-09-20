// src/api/hooks/usePasswordResetRequest.ts
// POST /auth/password/forgot — the server always returns { sent: true }
// regardless of whether the email is registered (no enumeration). Caller
// surfaces a generic success state regardless of backend response shape.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface PasswordResetRequestInput {
  email: string;
}

export function usePasswordResetRequest() {
  return useMutation({
    mutationFn: async (input: PasswordResetRequestInput) => {
      await apiClient.post('/auth/password/forgot', input, { skipAuth: true });
    },
  });
}