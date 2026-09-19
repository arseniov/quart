// src/components/__tests__/MapEmptyState.test.tsx
import { render, fireEvent } from '@testing-library/react-native';
import i18n from '@/i18n';
import { MapEmptyState } from '../issue/MapEmptyState';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

describe('MapEmptyState', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders headline, subtitle, and both CTAs in English', () => {
    const { getByText, getByLabelText } = render(<MapEmptyState />);
    expect(getByText(/No issues or polls in your area yet\./)).toBeTruthy();
    expect(getByText(/your report helps neighbors stay informed\./)).toBeTruthy();
    expect(getByLabelText('Flag an issue')).toBeTruthy();
    expect(getByLabelText('Browse the feed instead')).toBeTruthy();
  });

  it('Flag an issue CTA pushes to issue/new', () => {
    const { getByLabelText } = render(<MapEmptyState />);
    fireEvent.press(getByLabelText('Flag an issue'));
    expect(mockPush).toHaveBeenCalledWith('/issue/new');
  });

  it('Browse the feed CTA pushes to the feed tab', () => {
    const { getByLabelText } = render(<MapEmptyState />);
    fireEvent.press(getByLabelText('Browse the feed instead'));
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('renders Italian copy when locale is it', async () => {
    await i18n.changeLanguage('it');
    const { getByText } = render(<MapEmptyState />);
    expect(getByText(/Ancora nessun problema o sondaggio/)).toBeTruthy();
    expect(getByText(/Segnala un problema/)).toBeTruthy();
    expect(getByText(/Sfoglia il feed invece/)).toBeTruthy();
    await i18n.changeLanguage('en');
  });
});