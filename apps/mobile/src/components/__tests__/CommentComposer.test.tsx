// src/components/__tests__/CommentComposer.test.tsx
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockMutateAsync = jest.fn();
jest.mock('@/api/hooks/useIdeaComments', () => ({
  usePostIdeaComment: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    reset: jest.fn(),
  }),
}));

import { CommentComposer } from '@/components/idea/CommentComposer';

describe('CommentComposer', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    mockMutateAsync.mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('submit is disabled when body is empty', () => {
    const { getByRole } = render(<CommentComposer ideaId="i1" />);
    const btn = getByRole('button');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('enables submit once body has non-whitespace text', async () => {
    const { getByPlaceholderText, getByRole } = render(<CommentComposer ideaId="i1" />);
    const input = getByPlaceholderText(/Add a comment/i);
    await act(async () => {
      fireEvent.changeText(input, 'hello');
    });
    const btn = getByRole('button');
    expect(btn.props.accessibilityState?.disabled).toBe(false);
  });

  it('on submit fires mutation with trimmed body and clears input on success', async () => {
    mockMutateAsync.mockResolvedValue({ id: 'c1' });
    const { getByPlaceholderText, getByRole, queryByText } = render(<CommentComposer ideaId="i1" />);
    const input = getByPlaceholderText(/Add a comment/i);
    await act(async () => {
      fireEvent.changeText(input, '  hello world  ');
    });
    await act(async () => {
      fireEvent.press(getByRole('button'));
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({ body: 'hello world' });
    expect(input.props.value).toBe('');
    expect(queryByText(/\/ 5000/)).toBeNull();
  });

  it('shows character counter when body > 4500 chars', async () => {
    const { getByPlaceholderText, getByText } = render(<CommentComposer ideaId="i1" />);
    const input = getByPlaceholderText(/Add a comment/i);
    await act(async () => {
      fireEvent.changeText(input, 'a'.repeat(4600));
    });
    expect(getByText('4600 / 5000')).toBeTruthy();
  });

  it('does not show character counter for body <= 4500 chars', async () => {
    const { getByPlaceholderText, queryByText } = render(<CommentComposer ideaId="i1" />);
    const input = getByPlaceholderText(/Add a comment/i);
    await act(async () => {
      fireEvent.changeText(input, 'a'.repeat(4500));
    });
    expect(queryByText(/4500 \/ 5000/)).toBeNull();
  });

  it('shows error toast on mutation failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('boom'));
    const { getByPlaceholderText, getByRole } = render(<CommentComposer ideaId="i1" />);
    const input = getByPlaceholderText(/Add a comment/i);
    await act(async () => {
      fireEvent.changeText(input, 'hello');
    });
    await act(async () => {
      fireEvent.press(getByRole('button'));
    });
    expect(mockMutateAsync).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });
});
