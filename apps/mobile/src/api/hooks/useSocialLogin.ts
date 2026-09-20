// src/api/hooks/useSocialLogin.ts
// One hook for Apple + Google sign-in. Caller fetches the provider's idToken
// (and userId where applicable), then invokes mutateAsync. Errors propagate
// so the caller can choose silent-vs-Alert behavior per provider
// (e.g. ERR_CANCELED from AppleAuthentication is silent).
//
// TODO(GH #48): BA's /auth/sign-in/social endpoint expects
// `{ provider, idToken: { token, ... } }` (nested idToken object), not
// the flat `{ provider, idToken: <string> }` the mobile sends today —
// once that body shape lands, this hook should extract the BA session
// cookie via extractBaSessionToken and persist it via saveTokens. The
// pre-BA JWT minting is gone (GH #45); no saveTokens call here for now.
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';
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
        { provider: input.provider, idToken: input.idToken },
        { skipAuth: true },
      );
      // ponytail: BA session cookie not yet persisted from this flow (GH #48) —
      //        see file header. Apple userId for silent re-auth stays.
      if (input.provider === 'apple' && input.userId) {
        mmkvStorage.setItem(APPLE_USER_KEY, input.userId);
      }
      // ponytail: same swallow-NotificationsPermissionError pattern as useLogin — register-device
      //        is best-effort post-auth; user denying notifications must not fail social login.
      try {
        await register.mutateAsync();
      } catch (e) {
        if (!(e instanceof NotificationsPermissionError)) throw e;
      }
      return r.data;
    },
  });
}