// app/(app)/__tests__/search.test.tsx
// GH #23 — locks down the screen idioms: empty state CTA, initial prompt,
// error retry, and the result list path. Inline mocks per project convention.
// Uses jest fake timers + act() to advance past the 250ms debounce.
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));

jest.mock('@/api/hooks/useMe', () => ({
  useMe: jest.fn(),
}));

jest.mock('@/api/hooks/useSearch', () => ({
  useSearch: jest.fn(),
}));

jest.mock('@/components/feed/FeedItem', () => {
  const { View } = require('react-native');
  return {
    FeedItem: ({ item }: { item: { id: string; title: string } }) => (
      <View testID={`feed-item-${item.id}`} />
    ),
  };
});

import { useMe } from '@/api/hooks/useMe';
import { useSearch } from '@/api/hooks/useSearch';
import SearchScreen from '../search';

const mUseMe = useMe as jest.Mock;
const mUseSearch = useSearch as jest.Mock;

const makeMe = (city_id: string | null = 'c-1') => ({
  id: 'u-1',
  handle: 'u1',
  display_name: 'U',
  email: null,
  phone_e164: null,
  avatar_url: null,
  preferred_locale: 'en',
  roles: [],
  needs_onboarding: false,
  city_id,
});

function typeAndDebounce(
  input: { props: { onChangeText: (v: string) => void } },
  value: string,
) {
  act(() => {
    input.props.onChangeText(value);
  });
  act(() => {
    jest.advanceTimersByTime(300);
  });
}

describe('SearchScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    mUseMe.mockReset();
    mUseSearch.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the initial prompt before the user types', () => {
    mUseMe.mockReturnValue({ data: makeMe(), isPending: false });
    mUseSearch.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByText } = render(<SearchScreen />);
    expect(getByText('Type to search across your city.')).toBeTruthy();
  });

  it('passes city_id from useMe into useSearch', () => {
    mUseMe.mockReturnValue({ data: makeMe('c-milano'), isPending: false });
    mUseSearch.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: jest.fn(),
    });
    render(<SearchScreen />);
    expect(mUseSearch).toHaveBeenCalled();
    const args = mUseSearch.mock.calls[0][0];
    expect(args.city_id).toBe('c-milano');
  });

  it('shows the empty state with a "Suggest an idea" CTA that routes to /idea/compose', async () => {
    mUseMe.mockReturnValue({ data: makeMe(), isPending: false });
    mUseSearch.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByLabelText, getByText } = render(<SearchScreen />);
    const input = getByLabelText('Search query');
    typeAndDebounce(input, 'buca');
    await waitFor(() => expect(getByText('No matches for "buca".')).toBeTruthy());
    fireEvent.press(getByText('Suggest an idea'));
    expect(mockPush).toHaveBeenCalledWith('/idea/compose');
  });

  it('renders one FeedItem per search hit', async () => {
    mUseMe.mockReturnValue({ data: makeMe(), isPending: false });
    mUseSearch.mockReturnValue({
      data: [
        { id: 'iss-1', kind: 'issue', cityId: 'c-1', createdAt: '', rank: 0.7, title: 'Buca' },
        { id: 'p-1', kind: 'poll', cityId: 'c-1', createdAt: '', rank: null, title: 'Park?' },
      ],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByLabelText, getByTestId } = render(<SearchScreen />);
    const input = getByLabelText('Search query');
    typeAndDebounce(input, 'buca');
    await waitFor(() => {
      expect(getByTestId('feed-item-iss-1')).toBeTruthy();
      expect(getByTestId('feed-item-p-1')).toBeTruthy();
    });
  });

  it('shows error + retry button when useSearch reports an error', async () => {
    const refetch = jest.fn();
    mUseMe.mockReturnValue({ data: makeMe(), isPending: false });
    mUseSearch.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    const { getByLabelText, getByText } = render(<SearchScreen />);
    const input = getByLabelText('Search query');
    typeAndDebounce(input, 'buca');
    await waitFor(() => expect(getByText('You appear to be offline.')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});
