// src/api/hooks/useLogin.ts
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { saveTokens } from '@/lib/auth';
import { deviceFingerprint } from '@/lib/device-fingerprint';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export function useLogin() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const fp = await deviceFingerprint();
      const r = await apiClient.post<{ access_token: string; refresh_token: string }>(
        '/auth/login',
        { ...input, device_fingerprint: fp },
        { skipAuth: true },
      );
      await saveTokens({ accessToken: r.data.access_token, refreshToken: r.data.refresh_token });
      // ponytail: silently swallow NotificationsPermissionError — user denied notifications but
      //          login must succeed; surface only real failures via throw.
      try {
        await register.mutateAsync();
      } catch (e) {
        if (!(e instanceof NotificationsPermissionError)) throw e;
      }
      return r.data;
    },
  });
}
