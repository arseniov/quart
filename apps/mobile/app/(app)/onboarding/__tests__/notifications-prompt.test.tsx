// app/(app)/onboarding/__tests__/notifications-prompt.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // ponytail: Redirect is referenced by expo-router's typedef but unused at test render time.
  Redirect: () => null,
}));

jest.mock('@/api/hooks/useCompleteOnboarding', () => ({
  useCompleteOnboarding: jest.fn(),
}));

jest.mock('@/stores/onboarding', () => jest.requireActual('@/stores/onboarding'));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
}));

import { useCompleteOnboarding } from '@/api/hooks/useCompleteOnboarding';
import { useOnboardingStore } from '@/stores/onboarding';
import OnboardingNotificationsPrompt from '../notifications-prompt';

const mUseComplete = useCompleteOnboarding as jest.Mock;

describe('OnboardingNotificationsPrompt', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockReplace.mockClear();
    useOnboardingStore.getState().reset();
    useOnboardingStore.getState().setCity('c1');
    useOnboardingStore.getState().setNeighborhood('n1');
    mUseComplete.mockReset().mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('renders without crashing when city + neighborhood are set', () => {
    const { getByText } = render(<OnboardingNotificationsPrompt />);
    expect(getByText('Stay in the loop?')).toBeTruthy();
  });

  it('renders a ProgressBar component (Step 4 of 4)', () => {
    const { getByLabelText } = render(<OnboardingNotificationsPrompt />);
    expect(getByLabelText('Step 4 of 4')).toBeTruthy();
  });

  it('renders the Enable + Later buttons', () => {
    const { getByText } = render(<OnboardingNotificationsPrompt />);
    expect(getByText('Enable notifications')).toBeTruthy();
    expect(getByText('Later')).toBeTruthy();
  });
});
