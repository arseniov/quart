// src/api/hooks/useLogin.ts
// GH #46: POST /auth/sign-in/email → BA's standard email+password endpoint.
// BA returns `{ user, redirect, url }` in the body and sets the session
// cookie via Set-Cookie; we extract the cookie value, persist it via
// saveTokens, and let the screen route to /(app).
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient, ApiError } from '@/api/client';
import { extractBaSessionToken } from '@/api/ba-cookie';
import { saveTokens } from '@/lib/auth';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export interface BaSignInUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface BaSignInResponse {
  user: BaSignInUser;
  redirect?: boolean;
  url?: string;
}

export function useLogin() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: LoginInput): Promise<BaSignInResponse> => {
      const r = await apiClient.post<BaSignInResponse>(
        '/auth/sign-in/email',
        { email: input.email, password: input.password },
        { skipAuth: true },
      );
      const baSessionToken = extractBaSessionToken(r.headers);
      if (!baSessionToken) {
        throw new ApiError(500, 'auth.no_session', 'no session cookie in sign-in response');
      }
      saveTokens({ baSessionToken });
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