// src/components/__tests__/ProgressBar.test.tsx
import { render } from '@testing-library/react-native';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('marks current step', () => {
    const { getByLabelText } = render(<ProgressBar current={2} total={4} />);
    expect(getByLabelText('Step 2 of 4')).toBeTruthy();
  });

  it('renders one combined accessibility label', () => {
    const { getByLabelText } = render(<ProgressBar current={1} total={3} />);
    expect(getByLabelText('Step 1 of 3')).toBeTruthy();
  });
});
