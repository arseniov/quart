// src/components/ui/__tests__/ImageCached.test.tsx
import { render } from '@testing-library/react-native';
import { ImageCached } from '../ImageCached';

describe('ImageCached', () => {
  it('renders with accessibilityLabel forwarded to the inner Image', () => {
    const { getByLabelText } = render(
      <ImageCached
        source={{ uri: 'https://example.com/cat.png' }}
        accessibilityLabel="A cat"
      />,
    );
    expect(getByLabelText('A cat')).toBeTruthy();
  });
});