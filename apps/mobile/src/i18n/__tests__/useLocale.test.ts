// src/i18n/__tests__/useLocale.test.ts
import { resolveLocale } from '../useLocale';

describe('resolveLocale', () => {
  it('returns user locale when supported', () => {
    expect(resolveLocale({ systemLocale: 'en-US', userLocale: 'it' })).toBe('it');
  });

  it('falls back to system locale when user unset', () => {
    expect(resolveLocale({ systemLocale: 'en-US', userLocale: null })).toBe('en');
  });

  it('falls back to EN when neither supported', () => {
    expect(resolveLocale({ systemLocale: 'pt-BR', userLocale: null })).toBe('en');
  });

  it('maps it-CH to it', () => {
    expect(resolveLocale({ systemLocale: 'it-CH', userLocale: null })).toBe('it');
  });
});
