// app/(app)/onboarding/__tests__/language.test.tsx
// GH #36 — happy path: tapping a locale row fires i18n.changeLanguage immediately,
// persists to MMKV, and advances to the next onboarding step.
// (Server persistence of preferred_locale is sent later by notifications-prompt via useCompleteOnboarding.)

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));

jest.mock('@/lib/storage', () => ({
  mmkvStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('@/stores/onboarding', () => jest.requireActual('@/stores/onboarding'));

import { mmkvStorage } from '@/lib/storage';
import OnboardingLanguage from '../language';

const mMmkvStorage = mmkvStorage as unknown as {
  setItem: jest.Mock;
  getItem: jest.Mock;
  removeItem: jest.Mock;
};

describe('OnboardingLanguage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('it');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(async () => {
    mockPush.mockClear();
    mMmkvStorage.setItem.mockClear();
    // ponytail: reset locale per-test — the "tap a row" test mutates i18n to 'en',
    //          which would otherwise make the no-op test see Italiano as foreign.
    await i18n.changeLanguage('it');
  });

  it('renders the title and both supported languages', () => {
    const { getByText } = render(<OnboardingLanguage />);
    expect(getByText('Scegli la tua lingua')).toBeTruthy();
    expect(getByText('Italiano')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
  });

  it('renders a ProgressBar (Step 4 of 5)', () => {
    const { getByLabelText } = render(<OnboardingLanguage />);
    expect(getByLabelText('Step 4 of 5')).toBeTruthy();
  });

  it('marks the current language as selected', () => {
    const { getByLabelText } = render(<OnboardingLanguage />);
    // ponytail: i18n is 'it' from beforeAll, so Italiano is selected, English is not.
    expect(getByLabelText('Italiano').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(getByLabelText('English').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it('tapping a row fires i18n.changeLanguage + persists to MMKV + advances', async () => {
    const { getByLabelText } = render(<OnboardingLanguage />);

    fireEvent.press(getByLabelText('English'));

    await waitFor(() => {
      expect(i18n.language).toBe('en');
    });
    expect(mMmkvStorage.setItem).toHaveBeenCalledWith('i18n.lng', 'en');
    expect(mockPush).toHaveBeenCalledWith('/onboarding/notifications-prompt');
  });

  it('is a no-op when tapping the already-current language', () => {
    const { getByLabelText } = render(<OnboardingLanguage />);

    fireEvent.press(getByLabelText('Italiano'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(mMmkvStorage.setItem).not.toHaveBeenCalled();
  });
});