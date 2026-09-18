import { render } from '@testing-library/react-native';
import { FeedItem } from '../feed/FeedItem';

describe('FeedItem', () => {
  it('renders poll variant title', () => {
    const { getByText } = render(
      <FeedItem
        item={{
          kind: 'poll',
          id: '1',
          title: 'Bici in centro?',
          excerpt: '3 opzioni',
          created_at: new Date().toISOString(),
          city_id: 'c',
        }}
      />,
    );
    expect(getByText('Bici in centro?')).toBeTruthy();
  });
});
