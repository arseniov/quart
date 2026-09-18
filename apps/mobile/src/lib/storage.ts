import { MMKV } from 'react-native-mmkv';

// ponytail: add SecureStore instance here in Task 18 (sensitive) alongside the non-sensitive MMKV
// ponytail: sync API required by @tanstack/query-sync-storage-persister contract.
// MMKV itself is sync, so this is zero-cost.
const mmkv = new MMKV({ id: 'quart.cache' });

export const mmkvStorage = {
  getItem(key: string): string | null {
    return mmkv.getString(key) ?? null;
  },
  setItem(key: string, value: string): void {
    mmkv.set(key, value);
  },
  removeItem(key: string): void {
    mmkv.delete(key);
  },
};

export { mmkv };