// src/api/hooks/useLogin.ts
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';
import { deviceFingerprint } from '@/lib/device-fingerprint';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export function useLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const fp = await deviceFingerprint();
      const r = await apiClient.post<{ access_token: string; refresh_token: string }>(
        '/auth/login',
        { ...input, device_fingerprint: fp },
        { skipAuth: true },
      );
      await saveTokens({ accessToken: r.data.access_token, refreshToken: r.data.refresh_token });
      return r.data;
    },
  });
}