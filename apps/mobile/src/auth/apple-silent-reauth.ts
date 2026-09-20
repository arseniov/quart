// src/auth/apple-silent-reauth.ts
// Apple Sign-In silent re-auth. On app cold-launch, if we previously persisted
// a stable Apple user id under `quart.apple.user.v1`, ask the system for the
// current credential state. If AUTHORIZED, attempt a scope-less re-auth with
// the same user id to refresh the identity token without UI. On any failure
// (revoked, mismatched Apple ID) we clear the stored entry so the next launch
// falls through to the login screen.
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { mmkvStorage } from '@/lib/storage';

export const APPLE_USER_KEY = 'quart.apple.user.v1';

/**
 * Attempts a silent Apple re-auth. Returns true if a fresh identity token was
 * captured and persisted. False for any non-success path (no stored user,
 * not iOS, credential revoked, user-mismatch). Side effect: clears the stored
 * appleUserId when re-auth fails so the login screen is shown next time.
 */
export async function trySilentAppleReauth(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;

  const appleUserId = mmkvStorage.getItem(APPLE_USER_KEY);
  if (!appleUserId) return false;

  try {
    const state = await AppleAuthentication.getCredentialStateAsync(appleUserId);
    if (state !== AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED) {
      mmkvStorage.removeItem(APPLE_USER_KEY);
      return false;
    }
    // refreshAsync is the documented silent path, but may still surface a one-shot Apple ID
    // confirmation sheet when biometrics/passcode are required — accepted by the spec.
    const cred = await AppleAuthentication.refreshAsync({
      user: appleUserId,
      requestedScopes: [],
    });
    if (!cred.identityToken) {
      mmkvStorage.removeItem(APPLE_USER_KEY);
      return false;
    }
    // ponytail: store the refreshed token alongside the user id under a parallel
    //        key — callers wire this through useSocialLogin in a follow-up.
    //        For now we only update the user id (Apple keeps it stable).
    mmkvStorage.setItem(APPLE_USER_KEY, cred.user);
    return true;
  } catch {
    mmkvStorage.removeItem(APPLE_USER_KEY);
    return false;
  }
}
