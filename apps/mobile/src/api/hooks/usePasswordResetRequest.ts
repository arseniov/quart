// src/api/hooks/usePasswordResetRequest.ts
// POST /auth/password/reset-request — the server always returns 200 with no
// body differentiation between registered/unregistered emails (no enumeration).
// Caller surfaces a generic success state regardless of backend response shape.
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface PasswordResetRequestInput {
  email: string;
}

export function usePasswordResetRequest() {
  return useMutation({
    mutationFn: async (input: PasswordResetRequestInput) => {
      await apiClient.post('/auth/password/reset-request', input, { skipAuth: true });
    },
  });
}
