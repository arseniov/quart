// src/api/hooks/useIdea.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export const IdeaSchema = z.object({
  id: z.string().uuid(),
  city_id: z.string().uuid(),
  author_user_id: z.string().uuid(),
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(8000),
  upvotes: z.number().int().nonnegative(),
  user_upvoted: z.boolean(),
  status: z.enum(['draft', 'published', 'hidden', 'rejected']),
  published_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

export type Idea = z.infer<typeof IdeaSchema>;

export interface IdeaComments {
  idea: Idea;
  comments: Array<{ id: string; body: string; author_handle: string; created_at: string }>;
}

export function useIdea(id: string) {
  return useQuery({
    queryKey: queryKeys.idea(id),
    queryFn: async () => {
      const r = await apiClient.get<{
        idea: Idea;
        comments: Array<{ id: string; body: string; author_handle: string; created_at: string }>;
      }>(`/ideas/${id}`);
      return r.data;
    },
  });
}

export function useCreateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; body: string; neighborhood_id?: string }) => {
      const r = await apiClient.post<{ idea: Idea }>(`/ideas`, input);
      return r.data.idea;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ideas'] }),
  });
}

export function useUpvoteIdea(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await apiClient.post<{ idea: Idea }>(`/ideas/${id}/upvote`);
      return r.data.idea;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: queryKeys.idea(id) });
      const prev = qc.getQueryData<IdeaComments>(queryKeys.idea(id));
      if (prev) {
        qc.setQueryData<IdeaComments>(queryKeys.idea(id), {
          ...prev,
          idea: { ...prev.idea, upvotes: prev.idea.upvotes + 1, user_upvoted: true },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.idea(id), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.idea(id) }),
  });
}
