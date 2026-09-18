// src/api/hooks/useUpdatePrefs.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import type { Me } from '@/api/hooks/useMe';

export type UpdateMeInput = Partial<Pick<Me, 'preferred_locale' | 'display_name'>>;

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMeInput) => {
      const r = await apiClient.patch<Me>('/me', input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me() }),
  });
}

export function useTopicSubscriptions() {
  return useQuery({
    queryKey: queryKeys.topicSubscriptions(),
    queryFn: async () => {
      const r = await apiClient.get<{ topic_ids: string[] }>('/me/topic-subscriptions');
      return r.data.topic_ids;
    },
    staleTime: 60_000,
  });
}

export function useUpdateTopicSubscriptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (topic_ids: string[]) => {
      const r = await apiClient.put<{ topic_ids: string[] }>('/me/topic-subscriptions', {
        topic_ids,
      });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.me() });
      qc.invalidateQueries({ queryKey: queryKeys.topicSubscriptions() });
    },
  });
}
