// app/(app)/onboarding/__tests__/city.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));

jest.mock('@/api/hooks/useCities', () => ({
  useCities: jest.fn(),
}));

jest.mock('@/stores/onboarding', () => {
  // ponytail: keep the real store; tests reset state via setState. Re-export the hook for cleanup.
  const actual = jest.requireActual('@/stores/onboarding');
  return actual;
});

import { useCities } from '@/api/hooks/useCities';
import { useOnboardingStore } from '@/stores/onboarding';
import OnboardingCity from '../city';

const mUseCities = useCities as jest.Mock;

describe('OnboardingCity', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockPush.mockClear();
    useOnboardingStore.getState().reset();
    mUseCities.mockReset().mockReturnValue({
      data: [{ id: 'c1', slug: 'milano', name: 'Milano', country_code: 'IT' }],
      isPending: false,
    });
  });

  it('renders without crashing', () => {
    const { getByText } = render(<OnboardingCity />);
    expect(getByText('Which city do you live in?')).toBeTruthy();
  });

  it('renders a ProgressBar component (Step X of Y accessibilityLabel)', () => {
    const { getByLabelText } = render(<OnboardingCity />);
    expect(getByLabelText('Step 1 of 4')).toBeTruthy();
  });

  it('renders the city list when useCities returns data', () => {
    const { getByText } = render(<OnboardingCity />);
    expect(getByText('Milano')).toBeTruthy();
  });
});
