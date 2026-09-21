// src/api/hooks/useLogin.ts
// GH #46: POST /auth/sign-in/email → BA's standard email+password endpoint.
// BA returns `{ user, redirect, url }` in the body and sets the session
// cookie via Set-Cookie; the helper in ba-session.ts persists it via
// saveTokens, and lets the screen route to /(app).
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { persistBaSessionFromResponse } from '@/api/ba-session';
import { apiClient } from '@/api/client';
import { useRegisterDevice } from '@/api/hooks/useRegisterDevice';

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
      await persistBaSessionFromResponse(r.headers, 'login', register);
      return r.data;
    },
  });
}
