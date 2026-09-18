// src/api/hooks/useFeed.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface FeedItem {
  kind: 'poll' | 'idea' | 'issue';
  id: string;
  title: string;
  excerpt: string;
  created_at: string;
  city_id: string;
  // discriminated union adds more fields per kind at render time
}

export interface FeedFilters {
  kind?: 'poll' | 'idea' | 'issue';
  city_id?: string;
  neighborhood_id?: string;
}

interface FeedPage {
  items: FeedItem[];
  next_cursor: string | null;
}

export function useFeed(filters: FeedFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.kind) params.set('kind', filters.kind);
      if (filters.city_id) params.set('city_id', filters.city_id);
      if (filters.neighborhood_id) params.set('neighborhood_id', filters.neighborhood_id);
      if (pageParam) params.set('cursor', pageParam);
      const r = await apiClient.get<FeedPage>(`/feed?${params}`);
      return r.data;
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 60_000,
  });
}
