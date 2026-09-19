// src/api/hooks/useSocialLogin.ts
// One hook for Apple + Google sign-in. Caller fetches the provider's idToken
// (and userId where applicable), then invokes mutateAsync. Errors propagate
// so the caller can choose silent-vs-Alert behavior per provider
// (e.g. ERR_CANCELED from AppleAuthentication is silent).
import { useMutation } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import {
  useRegisterDevice,
  NotificationsPermissionError,
} from '@/api/hooks/useRegisterDevice';
import { APPLE_USER_KEY } from '@/auth/apple-silent-reauth';
import { saveTokens } from '@/lib/auth';
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
      const r = await apiClient.post<{ access_token: string; refresh_token: string }>(
        '/auth/sign-in/social',
        { provider: input.provider, idToken: input.idToken },
        { skipAuth: true },
      );
      await saveTokens({ accessToken: r.data.access_token, refreshToken: r.data.refresh_token });
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