// src/components/user/__tests__/AuthorByline.test.tsx
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@/api/hooks/useUser', () => ({
  useUser: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

import { useUser } from '@/api/hooks/useUser';
import { AuthorByline } from '@/components/user/AuthorByline';

const mUseUser = useUser as jest.Mock;

// shortId() slices the first 8 chars. UUIDs start with 8 hex chars before the
// first hyphen, so they make for predictable fallback text.
const LOADING_UID = 'abcdef01-2345-6789-abcd-ef0123456789';
const OK_UID = '11111111-2222-3333-4444-555555555555';
const NOT_FOUND_UID = 'deadbeef-1111-2222-3333-444444444444';
const DELETED_UID = 'cafebabe-1111-2222-3333-444444444444';
const NETWORK_UID = 'feedface-1111-2222-3333-444444444444';

describe('AuthorByline', () => {
  beforeEach(() => {
    mUseUser.mockReset();
    mockPush.mockReset();
  });

  it('renders a non-tappable truncated id while the user is loading', () => {
    mUseUser.mockReturnValue({ isPending: true, data: undefined, isError: false });
    const { getByTestId, queryByTestId, getByText } = render(<AuthorByline userId={LOADING_UID} />);
    expect(getByTestId('author-byline-loading')).toBeTruthy();
    expect(queryByTestId('author-byline-link')).toBeNull();
    expect(queryByTestId('author-byline-fallback')).toBeNull();
    expect(getByText('@abcdef01')).toBeTruthy();
  });

  it('renders @handle and routes to /user/:id when the user loads', () => {
    mUseUser.mockReturnValue({
      isPending: false,
      data: { handle: 'alice', displayName: 'Alice' },
      isError: false,
    });
    const { getByText, getByLabelText, queryByTestId } = render(<AuthorByline userId={OK_UID} />);
    expect(getByText('@alice')).toBeTruthy();
    expect(getByLabelText('Profile of Alice')).toBeTruthy();
    expect(queryByTestId('author-byline-link')).toBeTruthy();
    expect(queryByTestId('author-byline-loading')).toBeNull();
    expect(queryByTestId('author-byline-fallback')).toBeNull();

    fireEvent.press(getByLabelText('Profile of Alice'));
    expect(mockPush).toHaveBeenCalledWith(`/user/${OK_UID}`);
  });

  it('falls back to truncated id and is non-tappable on 404', () => {
    mUseUser.mockReturnValue({
      isPending: false,
      data: undefined,
      isError: true,
      error: { status: 404 },
    });
    const { getByTestId, getByText, queryByTestId, queryByLabelText } = render(<AuthorByline userId={NOT_FOUND_UID} />);
    expect(getByTestId('author-byline-fallback')).toBeTruthy();
    expect(queryByTestId('author-byline-link')).toBeNull();
    expect(queryByTestId('author-byline-loading')).toBeNull();
    expect(getByText('@deadbeef')).toBeTruthy();
    expect(queryByLabelText(/Profile of/)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('falls back to truncated id and is non-tappable on 410 (soft-deleted)', () => {
    mUseUser.mockReturnValue({
      isPending: false,
      data: undefined,
      isError: true,
      error: { status: 410 },
    });
    const { getByTestId, getByText } = render(<AuthorByline userId={DELETED_UID} />);
    expect(getByTestId('author-byline-fallback')).toBeTruthy();
    expect(getByText('@cafebabe')).toBeTruthy();
  });

  it('falls back to truncated id on generic/network errors', () => {
    mUseUser.mockReturnValue({
      isPending: false,
      data: undefined,
      isError: true,
      error: new Error('boom'),
    });
    const { getByTestId, getByText } = render(<AuthorByline userId={NETWORK_UID} />);
    expect(getByTestId('author-byline-fallback')).toBeTruthy();
    expect(getByText('@feedface')).toBeTruthy();
  });
});