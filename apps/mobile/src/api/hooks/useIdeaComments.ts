// src/api/hooks/useIdeaComments.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface IdeaComment {
  id: string;
  parentType: 'idea' | 'issue' | 'poll';
  parentId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export function useIdeaComments(ideaId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.ideaComments(ideaId ?? ''),
    queryFn: async () => {
      const r = await apiClient.get<IdeaComment[]>(`/ideas/${ideaId}/comments`);
      return r.data;
    },
    enabled: !!ideaId,
    staleTime: 30_000,
  });
}

export function usePostIdeaComment(ideaId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: string }) => {
      const r = await apiClient.post<IdeaComment>(`/ideas/${ideaId}/comments`, input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.ideaComments(ideaId ?? '') }),
  });
}
