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
  accessToken: 'quart.access_token',
  refreshToken: 'quart.refresh_token',
  installSalt: 'quart_install_salt',
} as const;
