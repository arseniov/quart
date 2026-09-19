// app/(app)/onboarding/__tests__/topics.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));

jest.mock('@/api/hooks/useTopics', () => ({
  useTopics: jest.fn(),
}));

jest.mock('@/stores/onboarding', () => jest.requireActual('@/stores/onboarding'));

import { useTopics } from '@/api/hooks/useTopics';
import { useOnboardingStore } from '@/stores/onboarding';
import OnboardingTopics from '../topics';

const mUseTopics = useTopics as jest.Mock;

describe('OnboardingTopics', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockPush.mockClear();
    useOnboardingStore.getState().reset();
    mUseTopics.mockReset().mockReturnValue({
      data: [
        { id: 't1', code: 'mobility', name_i18n: { it: 'Mobilità', en: 'Mobility' }, category_id: 'c1' },
        { id: 't2', code: 'safety', name_i18n: { it: 'Sicurezza', en: 'Safety' }, category_id: 'c1' },
      ],
      isPending: false,
    });
  });

  it('renders without crashing', () => {
    const { getByText } = render(<OnboardingTopics />);
    expect(getByText('What are you interested in?')).toBeTruthy();
  });

  it('renders a ProgressBar component (Step 3 of 4)', () => {
    const { getByLabelText } = render(<OnboardingTopics />);
    expect(getByLabelText('Step 3 of 4')).toBeTruthy();
  });

  it('renders the topic list from useTopics data', () => {
    // ponytail: name_i18n.it is what the component renders regardless of i18n locale switch.
    const { getByText } = render(<OnboardingTopics />);
    expect(getByText('Mobilità')).toBeTruthy();
    expect(getByText('Sicurezza')).toBeTruthy();
  });
});
