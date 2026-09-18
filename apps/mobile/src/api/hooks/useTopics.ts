import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface Topic {
  id: string;
  code: string;
  name_i18n: { it: string; en: string };
  category_id: string;
}

export function useTopics() {
  return useQuery({
    queryKey: queryKeys.topics(),
    queryFn: async () => {
      const r = await apiClient.get<{ topics: Topic[] }>(`/topics`);
      return r.data.topics;
    },
    staleTime: 60 * 60 * 1000,
  });
}