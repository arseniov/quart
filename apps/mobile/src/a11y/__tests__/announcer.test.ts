// src/a11y/__tests__/announcer.test.ts
import { _setAnnouncer, getAnnouncer } from '../announcer';

describe('a11y announcer', () => {
  it('stores and retrieves message', () => {
    _setAnnouncer((msg) => msg);
    expect(getAnnouncer()('ciao')).toBe('ciao');
  });
});