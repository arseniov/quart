import { render } from '@testing-library/react-native';
import '@/i18n';
import { IdeaCard } from '../IdeaCard';

describe('IdeaCard', () => {
  it('renders title + excerpt + upvote count', () => {
    const { getByText } = render(
      <IdeaCard
        idea={{
          id: 'i',
          title: 'Aiuole in piazza',
          upvotes: 42,
        }}
        excerpt="Vediamo"
      />,
    );
    expect(getByText('Aiuole in piazza')).toBeTruthy();
    expect(getByText('Vediamo')).toBeTruthy();
    expect(getByText(/42/)).toBeTruthy();
  });
});
