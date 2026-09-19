// src/components/__tests__/CommentList.test.tsx
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

jest.mock('@/api/hooks/useIdeaComments', () => ({
  useIdeaComments: jest.fn(),
}));

jest.mock('@/components/Markdown', () => ({
  SafeMarkdown: ({ source }: { source: string }) => {
    const { Text } = require('react-native');
    return <Text>{source}</Text>;
  },
}));

import { useIdeaComments } from '@/api/hooks/useIdeaComments';
import { CommentList } from '@/components/idea/CommentList';

describe('CommentList', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    (useIdeaComments as jest.Mock).mockReset();
  });

  it('renders loading state when isPending', () => {
    (useIdeaComments as jest.Mock).mockReturnValue({ isPending: true, isError: false, data: undefined });
    const { getByText, getByTestId } = render(<CommentList ideaId="i1" />);
    expect(getByText(/Loading comments/i)).toBeTruthy();
    expect(getByTestId('comment-list-loading')).toBeTruthy();
  });

  it('renders empty state when no comments', () => {
    (useIdeaComments as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: [] });
    const { getByText } = render(<CommentList ideaId="i1" />);
    expect(getByText(/Be the first to comment/i)).toBeTruthy();
  });

  it('renders a row per comment', () => {
    (useIdeaComments as jest.Mock).mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        { id: 'c1', parentType: 'idea', parentId: 'i1', authorUserId: 'u1', body: 'first comment', createdAt: '2026-01-01T10:00:00Z' },
        { id: 'c2', parentType: 'idea', parentId: 'i1', authorUserId: 'u2', body: 'second comment', createdAt: '2026-01-02T10:00:00Z' },
      ],
    });
    const { getByText, getAllByText } = render(<CommentList ideaId="i1" />);
    expect(getByText('first comment')).toBeTruthy();
    expect(getByText('second comment')).toBeTruthy();
    expect(getAllByText(/@/)).toHaveLength(2);
  });

  it('renders error state with retry', () => {
    (useIdeaComments as jest.Mock).mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      refetch: jest.fn(),
    });
    const { getByText } = render(<CommentList ideaId="i1" />);
    expect(getByText(/Loading comments/i)).toBeTruthy();
    expect(getByText(/retry/i)).toBeTruthy();
  });

  it('returns null when ideaId is missing', () => {
    (useIdeaComments as jest.Mock).mockReturnValue({ isPending: false, isError: false, data: undefined, refetch: jest.fn() });
    const { toJSON } = render(<CommentList ideaId={null} />);
    expect(toJSON()).toBeNull();
  });
});
