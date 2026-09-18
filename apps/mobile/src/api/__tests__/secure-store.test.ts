jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { secureGet, secureSet, secureDelete } from '@/lib/secure-store';

const m = SecureStore as jest.Mocked<typeof SecureStore>;

describe('secure store', () => {
  beforeEach(() => jest.clearAllMocks());

  it('secureGet returns null when missing', async () => {
    m.getItemAsync.mockResolvedValueOnce(null);
    expect(await secureGet('x')).toBeNull();
  });

  it('secureSet writes through', async () => {
    m.setItemAsync.mockResolvedValueOnce();
    await secureSet('x', 'v');
    expect(m.setItemAsync).toHaveBeenCalledWith('x', 'v');
  });

  it('secureDelete removes key', async () => {
    m.deleteItemAsync.mockResolvedValueOnce();
    await secureDelete('x');
    expect(m.deleteItemAsync).toHaveBeenCalledWith('x');
  });
});
