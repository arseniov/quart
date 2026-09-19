// src/auth/__tests__/apple-silent-reauth.test.ts
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationCredentialState: { AUTHORIZED: 1, REVOKED: 0, NOT_FOUND: 2, TRANSFERRED: 3 },
  getCredentialStateAsync: jest.fn(),
  refreshAsync: jest.fn(),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));
jest.mock('@/lib/storage', () => ({
  mmkvStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

import * as AppleAuthentication from 'expo-apple-authentication';

import { APPLE_USER_KEY, trySilentAppleReauth } from '@/auth/apple-silent-reauth';
import { mmkvStorage } from '@/lib/storage';

describe('trySilentAppleReauth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when no stored appleUserId', async () => {
    (mmkvStorage.getItem as jest.Mock).mockReturnValue(null);
    await expect(trySilentAppleReauth()).resolves.toBe(false);
    expect(AppleAuthentication.getCredentialStateAsync).not.toHaveBeenCalled();
  });

  it('returns true and persists refreshed user when credential is AUTHORIZED', async () => {
    (mmkvStorage.getItem as jest.Mock).mockReturnValue('apple.user.123');
    (AppleAuthentication.getCredentialStateAsync as jest.Mock).mockResolvedValue(
      AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED,
    );
    (AppleAuthentication.refreshAsync as jest.Mock).mockResolvedValue({
      user: 'apple.user.123',
      identityToken: 'new-token',
    });

    await expect(trySilentAppleReauth()).resolves.toBe(true);
    expect(AppleAuthentication.getCredentialStateAsync).toHaveBeenCalledWith('apple.user.123');
    expect(AppleAuthentication.refreshAsync).toHaveBeenCalledWith({
      user: 'apple.user.123',
      requestedScopes: [],
    });
    expect(mmkvStorage.setItem).toHaveBeenCalledWith(APPLE_USER_KEY, 'apple.user.123');
  });

  it('clears stored entry and returns false when credential is REVOKED', async () => {
    (mmkvStorage.getItem as jest.Mock).mockReturnValue('apple.user.revoked');
    (AppleAuthentication.getCredentialStateAsync as jest.Mock).mockResolvedValue(
      AppleAuthentication.AppleAuthenticationCredentialState.REVOKED,
    );

    await expect(trySilentAppleReauth()).resolves.toBe(false);
    expect(mmkvStorage.removeItem).toHaveBeenCalledWith(APPLE_USER_KEY);
    expect(AppleAuthentication.refreshAsync).not.toHaveBeenCalled();
  });

  it('clears stored entry and returns false when re-auth throws', async () => {
    (mmkvStorage.getItem as jest.Mock).mockReturnValue('apple.user.err');
    (AppleAuthentication.getCredentialStateAsync as jest.Mock).mockResolvedValue(
      AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED,
    );
    (AppleAuthentication.refreshAsync as jest.Mock).mockRejectedValue(new Error('user-mismatch'));

    await expect(trySilentAppleReauth()).resolves.toBe(false);
    expect(mmkvStorage.removeItem).toHaveBeenCalledWith(APPLE_USER_KEY);
  });

  it('clears stored entry and returns false when re-auth returns no identityToken', async () => {
    (mmkvStorage.getItem as jest.Mock).mockReturnValue('apple.user.empty');
    (AppleAuthentication.getCredentialStateAsync as jest.Mock).mockResolvedValue(
      AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED,
    );
    (AppleAuthentication.refreshAsync as jest.Mock).mockResolvedValue({ user: 'apple.user.empty' });

    await expect(trySilentAppleReauth()).resolves.toBe(false);
    expect(mmkvStorage.removeItem).toHaveBeenCalledWith(APPLE_USER_KEY);
  });
});
