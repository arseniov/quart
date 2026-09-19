// app/(app)/onboarding/__tests__/neighborhood.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Redirect: () => null,
}));

jest.mock('@/stores/onboarding', () => jest.requireActual('@/stores/onboarding'));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: jest.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import { useOnboardingStore } from '@/stores/onboarding';
import OnboardingNeighborhood from '../neighborhood';

const mUseQuery = useQuery as jest.Mock;

describe('OnboardingNeighborhood', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockPush.mockClear();
    useOnboardingStore.getState().reset();
    // ponytail: seed a city so the `enabled: !!city` branch runs and the FlatList renders.
    useOnboardingStore.getState().setCity('c1');
    mUseQuery.mockReset().mockReturnValue({
      data: [{ id: 'n1', name: 'Navigli' }],
      isPending: false,
    });
  });

  it('renders without crashing', () => {
    const { getByText } = render(<OnboardingNeighborhood />);
    expect(getByText('Which neighborhood?')).toBeTruthy();
  });

  it('renders a ProgressBar component (Step 2 of 4)', () => {
    const { getByLabelText } = render(<OnboardingNeighborhood />);
    expect(getByLabelText('Step 2 of 4')).toBeTruthy();
  });

  it('renders the neighborhood list from the queried data', () => {
    const { getByText } = render(<OnboardingNeighborhood />);
    expect(getByText('Navigli')).toBeTruthy();
  });
});
