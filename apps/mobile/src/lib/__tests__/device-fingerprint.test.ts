jest.mock('expo-application', () => ({
  applicationId: 'app.quart.mobile',
  getInstallReferrerAsync: jest.fn().mockResolvedValue('referrer'),
  nativeApplicationVersion: '0.0.1',
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32).fill(0xab)),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algo: string, _data: string) => {
    // ponytail: 64-char hex string mock. jest-expo doesn't auto-mock expo-crypto,
    // so we fake a deterministic SHA-256-shaped output for unit tests.
    return 'a'.repeat(64);
  }),
}));

import { deviceFingerprint, _resetFingerprintForTests } from '../device-fingerprint';
import * as SecureStore from 'expo-secure-store';

describe('deviceFingerprint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ponytail: reset module-level cache so each test exercises the salt path;
    // jest doesn't reload modules between tests by default
    _resetFingerprintForTests();
  });

  it('returns 64 hex chars', async () => {
    const fp = await deviceFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls within session', async () => {
    const a = await deviceFingerprint();
    const b = await deviceFingerprint();
    expect(a).toBe(b);
  });

  it('persists salt on first call', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    await deviceFingerprint();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('quart_install_salt', expect.any(String));
  });
});
