// src/api/hooks/useSignup.ts
// GH #35: email + password sign-up. Mirrors useLogin's shape so the screen
// can route to /(app) after a successful mutation. BA's sign-up response
// carries a session token; the API's internal LoginController-style wrapper
// re-issues the standard { access_token, refresh_token, refresh_expires_at, user }
// pair so saveTokens / react-query clients stay one-shape.
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient } from '@/api/client';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';
import { saveTokens } from '@/lib/auth';
import { deviceFingerprint } from '@/lib/device-fingerprint';

export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().min(1).max(40),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export function useSignup() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: SignupInput) => {
      const fp = await deviceFingerprint();
      const r = await apiClient.post<{ access_token: string; refresh_token: string }>(
        '/auth/sign-up',
        { ...input, device_fingerprint: fp },
        { skipAuth: true },
      );
      await saveTokens({ accessToken: r.data.access_token, refreshToken: r.data.refresh_token });
      // ponytail: silently swallow NotificationsPermissionError — user denied
      // notifications but sign-up must succeed; surface only real failures.
      try {
        await register.mutateAsync();
      } catch (e) {
        if (!(e instanceof NotificationsPermissionError)) throw e;
      }
      return r.data;
    },
  });
}