import { t, supportedLngs } from '../index';

describe('i18n', () => {
  it('exposes IT and EN', () => {
    expect(supportedLngs).toEqual(expect.arrayContaining(['it', 'en']));
  });

  it('translates IT key', () => {
    expect(t('it', 'nav.home')).toBe('Home');
  });

  it('translates EN key', () => {
    expect(t('en', 'nav.home')).toBe('Home');
  });

  it('falls back to EN for unknown key in IT', () => {
    expect(t('it', 'nonexistent.key' as never)).toBe('nonexistent.key');
  });
});
