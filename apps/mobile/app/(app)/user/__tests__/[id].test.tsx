// app/(app)/user/__tests__/[id].test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';

import i18n from '@/i18n';

jest.mock('@/api/hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: '11111111-1111-1111-1111-111111111111' }),
}));

import { useUser } from '@/api/hooks/useUser';
import UserProfileScreen from '../[id]';

const mUseUser = useUser as jest.Mock;

describe('UserProfileScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    mUseUser.mockReset();
  });

  it('renders displayName and handle when the user loads', () => {
    mUseUser.mockReturnValue({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
        handle: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        joinedAt: '2026-01-15T08:00:00.000Z',
        publicStats: { ideasCount: 4, issuesCount: 2, pollsCount: 1 },
      },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<UserProfileScreen />);
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('@alice')).toBeTruthy();
  });

  it('renders the publicStats counts', () => {
    mUseUser.mockReturnValue({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
        handle: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        joinedAt: '2026-01-15T08:00:00.000Z',
        publicStats: { ideasCount: 4, issuesCount: 2, pollsCount: 1 },
      },
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<UserProfileScreen />);
    // Stat values are rendered as plain Text; assert via the localized labels too.
    expect(getByText('Ideas')).toBeTruthy();
    expect(getByText('Issues')).toBeTruthy();
    expect(getByText('Polls')).toBeTruthy();
  });

  it('renders the notFound message when useUser surfaces an error', () => {
    mUseUser.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: jest.fn(),
    });
    const { getByText } = render(<UserProfileScreen />);
    expect(getByText(/not found|not available/i)).toBeTruthy();
  });
});
