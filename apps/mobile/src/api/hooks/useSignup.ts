// src/api/hooks/useSignup.ts
// GH #46: POST /auth/sign-up/email → BA's standard email+password sign-up.
// Body uses BA's `name` field (not the legacy `display_name`). BA returns
// the user row at the top level (flat — no nested `user` envelope) and
// sets the session cookie via Set-Cookie; the helper in ba-session.ts
// persists the cookie via saveTokens, and the screen routes to /(app).
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { persistBaSessionFromResponse } from '@/api/ba-session';
import { apiClient } from '@/api/client';
import { useRegisterDevice } from '@/api/hooks/useRegisterDevice';

export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(40),
});
export type SignupInput = z.infer<typeof SignupSchema>;

export interface BaSignUpUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type BaSignUpResponse = BaSignUpUser;

export function useSignup() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: SignupInput): Promise<BaSignUpResponse> => {
      const r = await apiClient.post<BaSignUpResponse>(
        '/auth/sign-up/email',
        { email: input.email, password: input.password, name: input.name },
        { skipAuth: true },
      );
      await persistBaSessionFromResponse(r.headers, 'signup', register);
      return r.data;
    },
  });
}
