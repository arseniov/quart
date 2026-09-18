// src/lib/__tests__/auth.test.ts
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { loadTokens } from '../auth';

const m = SecureStore as jest.Mocked<typeof SecureStore>;

describe('loadTokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when access token is missing', async () => {
    m.getItemAsync.mockResolvedValueOnce(null).mockResolvedValueOnce('refresh-x');
    expect(await loadTokens()).toBeNull();
  });

  it('returns null when refresh token is missing', async () => {
    m.getItemAsync.mockResolvedValueOnce('access-x').mockResolvedValueOnce(null);
    expect(await loadTokens()).toBeNull();
  });

  it('returns both tokens when both present', async () => {
    m.getItemAsync.mockResolvedValueOnce('access-x').mockResolvedValueOnce('refresh-y');
    expect(await loadTokens()).toEqual({ accessToken: 'access-x', refreshToken: 'refresh-y' });
  });
});