import { mmkvStorage } from '@/lib/storage';

describe('mmkvStorage', () => {
  it('roundtrips strings', async () => {
    await mmkvStorage.setItem('k', 'v');
    expect(await mmkvStorage.getItem('k')).toBe('v');
  });

  it('roundtrips JSON', async () => {
    await mmkvStorage.setItem('k2', JSON.stringify({ a: 1 }));
    expect(await mmkvStorage.getItem('k2')).toBe('{"a":1}');
  });

  it('returns null for missing key', async () => {
    expect(await mmkvStorage.getItem('absent')).toBeNull();
  });

  it('removes key', async () => {
    await mmkvStorage.setItem('rm', 'x');
    await mmkvStorage.removeItem('rm');
    expect(await mmkvStorage.getItem('rm')).toBeNull();
  });
});