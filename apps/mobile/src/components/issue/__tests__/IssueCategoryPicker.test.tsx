import '@/i18n';
import { render, fireEvent } from '@testing-library/react-native';
import { IssueCategoryPicker } from '../IssueCategoryPicker';

const cats = [
  { id: '1', code: 'pothole', name_i18n: { it: 'Buca', en: 'Pothole' }, icon_name: 'pothole', color_hex: '#d97706' },
  { id: '2', code: 'streetlight', name_i18n: { it: 'Lampione', en: 'Streetlight' }, icon_name: 'streetlight', color_hex: '#0ea5e9' },
];

describe('IssueCategoryPicker', () => {
  it('renders category list and selects on tap', () => {
    const onSelect = jest.fn();
    const { getByText } = render(<IssueCategoryPicker categories={cats} selected={null} onSelect={onSelect} />);
    fireEvent.press(getByText('Buca'));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('marks selected', () => {
    const { getByLabelText } = render(<IssueCategoryPicker categories={cats} selected="2" onSelect={() => {}} />);
    expect(getByLabelText('Lampione, selected').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });
});
