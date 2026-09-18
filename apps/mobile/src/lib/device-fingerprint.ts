// src/lib/device-fingerprint.ts
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

let cached: string | null = null;
let salt: string | null = null;

async function getSalt(): Promise<string> {
  if (salt) return salt;
  const existing = await SecureStore.getItemAsync('quart_install_salt');
  if (existing) {
    salt = existing;
    return existing;
  }
  // ponytail: 32 bytes of cryptographic entropy from expo-crypto (CSPRNG via OS RNG).
  // Replaces the plan's Math.random which was a non-CSPRNG at a trust boundary.
  const bytes = await Crypto.getRandomBytesAsync(32);
  const fresh = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync('quart_install_salt', fresh);
  salt = fresh;
  return fresh;
}

export async function deviceFingerprint(): Promise<string> {
  if (cached) return cached;
  const s = await getSalt();
  const parts = [
    Application.applicationId ?? 'unknown',
    Platform.OS,
    String(Platform.Version),
    Application.nativeApplicationVersion ?? '0.0.0',
    s,
  ].join('\n');
  // ponytail: expo-crypto.digestStringAsync → SHA-256 → hex (no js-sha256 dep needed).
  cached = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, parts);
  return cached;
}

export const _resetFingerprintForTests = __DEV__
  ? () => {
      cached = null;
      salt = null;
    }
  : () => {};
