import { render } from '@testing-library/react-native';
import '@/i18n';
import { PollCard } from '../PollCard';

describe('PollCard', () => {
  it('renders title and vote count', () => {
    const { getByText } = render(
      <PollCard poll={{
        id: 'p',
        city_id: 'c',
        title: 'Pista ciclabile?',
        body: null,
        closes_at: new Date(Date.now() + 86400000).toISOString(),
        user_voted_option_id: null,
        options: [
          { id: 'o1', label: 'Sì', votes: 12 },
          { id: 'o2', label: 'No', votes: 8 },
        ],
      }} />,
    );
    expect(getByText('Pista ciclabile?')).toBeTruthy();
    expect(getByText(/20/)).toBeTruthy();
  });

  it('shows voted badge', () => {
    const { getByText } = render(
      <PollCard poll={{
        id: 'p',
        city_id: 'c',
        title: 't',
        body: null,
        closes_at: new Date(Date.now() + 86400000).toISOString(),
        user_voted_option_id: 'o1',
        options: [{ id: 'o1', label: 'Sì', votes: 1 }],
      }} />,
    );
    expect(getByText(/voted|votato|hast/i)).toBeTruthy();
  });
});