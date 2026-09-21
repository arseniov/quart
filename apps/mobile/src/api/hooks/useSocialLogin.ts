// src/api/hooks/useSocialLogin.ts
// One hook for Apple + Google sign-in. Caller fetches the provider's idToken
// (and userId where applicable), then invokes mutateAsync. Errors propagate
// so the caller can choose silent-vs-Alert behavior per provider
// (e.g. ERR_CANCELED from AppleAuthentication is silent).
//
// GH #48: BA's /auth/sign-in/social endpoint expects
// `{ provider, idToken: { token, ... } }` (nested idToken object) — the body
// shape matches BA 1.0.20's zod schema in auth-B_LFm6_Y.d.ts:1582. We wrap
// the caller's string idToken in `{ token }` here so the screen's flat
// interface (just the provider's opaque token) stays unchanged. After the
// response, the helper in ba-session.ts extracts the BA session cookie and
// persists it via saveTokens; throws `auth.no_session` if the server omitted
// the cookie (mirrors useLogin).
import { useMutation } from '@tanstack/react-query';

import { persistBaSessionFromResponse } from '@/api/ba-session';
import { apiClient } from '@/api/client';
import { useRegisterDevice } from '@/api/hooks/useRegisterDevice';
import { APPLE_USER_KEY } from '@/auth/apple-silent-reauth';
import { mmkvStorage } from '@/lib/storage';

export type SocialProvider = 'apple' | 'google';

export interface SocialLoginInput {
  provider: SocialProvider;
  idToken: string;
  /** Apple-only: stable `user` value from the credential, persisted for future silent sign-in. */
  userId?: string;
}

export function useSocialLogin() {
  const register = useRegisterDevice();
  return useMutation({
    mutationFn: async (input: SocialLoginInput) => {
      const r = await apiClient.post<unknown>(
        '/auth/sign-in/social',
        { provider: input.provider, idToken: { token: input.idToken } },
        { skipAuth: true },
      );
      await persistBaSessionFromResponse(r.headers, 'social', register);
      // Apple caller-specific: persist the stable user id for future silent re-auth.
      if (input.provider === 'apple' && input.userId) {
        mmkvStorage.setItem(APPLE_USER_KEY, input.userId);
      }
      return r.data;
    },
  });
}
