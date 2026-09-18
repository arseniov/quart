// src/components/profile/__tests__/ProfileHeader.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
// ponytail: importing the module triggers `i18n.init()` in src/i18n/index.ts so useTranslation has resources
import i18n from '@/i18n';

const mockUseMe: jest.Mock = jest.fn();
jest.mock('@/api/hooks/useMe', () => ({
  useMe: () => mockUseMe(),
}));

import { ProfileHeader } from '../ProfileHeader';

describe('ProfileHeader', () => {
  beforeAll(() => {
    void i18n.changeLanguage('en');
  });
  beforeEach(() => mockUseMe.mockReset());

  it('renders loading skeleton when pending', () => {
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const { getByLabelText } = render(<ProfileHeader />);
    expect(getByLabelText('Loading…')).toBeTruthy();
  });

  it('renders retry UI on error', () => {
    const refetch = jest.fn();
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('boom'),
      refetch,
    });
    const { getByText } = render(<ProfileHeader />);
    expect(getByText('You appear to be offline.')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders avatar + display_name + handle on success', () => {
    mockUseMe.mockReturnValue({
      data: { id: 'u', handle: 'mario', display_name: 'Mario Rossi', avatar_url: null },
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const { getByText, getByLabelText } = render(<ProfileHeader />);
    expect(getByText('Mario Rossi')).toBeTruthy();
    expect(getByText('@mario')).toBeTruthy();
    expect(getByLabelText('Avatar placeholder for Mario Rossi')).toBeTruthy();
  });

  it('silently no-renders when data is missing without error or pending', () => {
    mockUseMe.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    });
    const { toJSON } = render(<ProfileHeader />);
    // Should not throw; returns empty fragment-like tree
    expect(toJSON()).toBeNull();
  });
});
