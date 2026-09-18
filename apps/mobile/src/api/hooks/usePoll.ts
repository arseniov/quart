// src/api/hooks/usePoll.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export const PollOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(120),
  votes: z.number().int().nonnegative(),
});

export const PollSchema = z.object({
  id: z.string().uuid(),
  city_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  body: z.string().max(5000).nullable(),
  options: z.array(PollOptionSchema).min(2).max(10),
  closes_at: z.string().datetime(),
  user_voted_option_id: z.string().uuid().nullable(),
});

export type Poll = z.infer<typeof PollSchema>;

export function usePoll(id: string) {
  return useQuery({
    queryKey: queryKeys.poll(id),
    queryFn: async () => {
      const r = await apiClient.get<{ poll: Poll }>(`/polls/${id}`);
      return PollSchema.parse(r.data.poll);
    },
    staleTime: 30_000,
  });
}

export function useVoteOnPoll(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (option_id: string) => {
      const r = await apiClient.post<{ poll: Poll }>(`/polls/${id}/vote`, { option_id });
      return r.data.poll;
    },
    onSuccess: (poll) => {
      qc.setQueryData(queryKeys.poll(id), poll);
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
