// src/lib/__tests__/auth.test.ts
// GH #46: BA session token lives in MMKV (sync). Mock the MMKV module so
// loadTokens reads from the mocked backing store.
jest.mock('react-native-mmkv', () => {
  const data = new Map<string, string>();
  return {
    MMKV: class {
      getString(key: string) { return data.get(key) ?? undefined; }
      set(key: string, value: string) { data.set(key, value); }
      delete(key: string) { data.delete(key); }
      // tests poke the backing store directly through the `data` map
      static __peek() { return data; }
    },
  };
});

import { loadTokens, saveTokens, clearTokens } from '../auth';

describe('loadTokens', () => {
  beforeEach(() => {
    const { MMKV } = jest.requireMock('react-native-mmkv') as { MMKV: { __peek: () => Map<string, string> } };
    MMKV.__peek().clear();
  });

  it('returns null when the BA session token is missing', () => {
    expect(loadTokens()).toBeNull();
  });

  it('returns the BA session token when present', () => {
    saveTokens({ baSessionToken: 'ba-session-tok' });
    expect(loadTokens()).toEqual({ baSessionToken: 'ba-session-tok' });
  });

  it('clearTokens removes the stored token', () => {
    saveTokens({ baSessionToken: 'ba-session-tok' });
    clearTokens();
    expect(loadTokens()).toBeNull();
  });
});