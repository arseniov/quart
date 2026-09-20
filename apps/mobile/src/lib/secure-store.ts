import * as SecureStore from 'expo-secure-store';

export async function secureGet(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export const SECURE_KEYS = {
  // GH #46: BA session token lives in MMKV (see `@/lib/auth`); installSalt
  // stays here for the device-fingerprint salt, which uses SecureStore
  // directly to keep cryptographic material off the JS heap.
  installSalt: 'quart_install_salt',
} as const;
