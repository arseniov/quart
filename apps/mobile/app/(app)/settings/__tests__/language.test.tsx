// app/(app)/settings/__tests__/language.test.tsx
// GH #37 — on rejected updateMe.mutateAsync, restore i18n.changeLanguage(previousLocale)
// and surface the error via Alert. On success, persist the new locale to MMKV so the next
// cold launch matches.

import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';

const mockMutateAsync = jest.fn();
jest.mock('@/api/hooks/useUpdatePrefs', () => ({
  useUpdateMe: () => ({
    mutateAsync: mockMutateAsync,
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock('@/api/hooks/useMe', () => ({
  useMe: () => ({
    data: { id: 'u1', handle: 'u1', preferred_locale: 'it' },
    isPending: false,
  }),
}));

jest.mock('@/lib/storage', () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

import LanguageSettings from '../language';

const mMmkvStorage = require('@/lib/storage').mmkvStorage as unknown as {
  setItem: jest.Mock;
};

describe('LanguageSettings — rollback on updateMe error (GH #37)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('it');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockMutateAsync.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mMmkvStorage.setItem.mockClear();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('on mutateAsync rejection, rolls i18n.language back to previous and surfaces an Alert', async () => {
    mockMutateAsync.mockRejectedValue(new Error('boom'));
    const { getByLabelText } = render(<LanguageSettings />);

    fireEvent.press(getByLabelText('English'));

    await waitFor(() => {
      expect(i18n.language).toBe('it');
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ preferred_locale: 'en' });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      expect.any(String),
      'boom',
    );
    // MMKV must NOT be written when the server PATCH fails — client and server must agree.
    expect(mMmkvStorage.setItem).not.toHaveBeenCalled();
  });

  it('on mutateAsync success, persists the new locale to MMKV so next cold launch matches', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'u1', preferred_locale: 'en' });
    const { getByLabelText } = render(<LanguageSettings />);

    fireEvent.press(getByLabelText('English'));

    await waitFor(() => {
      expect(mMmkvStorage.setItem).toHaveBeenCalledWith('i18n.lng', 'en');
    });
    expect(i18n.language).toBe('en');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('is a no-op when tapping the already-current language', () => {
    mockMutateAsync.mockResolvedValue({ id: 'u1', preferred_locale: 'it' });
    const { getByLabelText } = render(<LanguageSettings />);

    fireEvent.press(getByLabelText('Italiano'));

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mMmkvStorage.setItem).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
