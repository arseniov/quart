// src/components/__tests__/ProgressBar.test.tsx
import { render } from '@testing-library/react-native';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('marks current step', () => {
    const { getByLabelText } = render(<ProgressBar current={2} total={4} />);
    expect(getByLabelText('Step 2 of 4')).toBeTruthy();
  });

  it('renders N step indicators', () => {
    const { getAllByLabelText } = render(<ProgressBar current={1} total={3} />);
    expect(getAllByLabelText(/^Step \d+ of 3/)).toHaveLength(3);
  });
});