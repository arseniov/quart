// src/api/hooks/useSearch.ts
// GH #23 — `/search` hits the server-side FTS endpoint. The DTO mirrors
// `apps/api/src/search/search.dto.ts`. We do NOT introduce a new wire type
// — the response shape is the existing `SearchHit[]`.
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import type { SearchFilters } from '@/api/query-client';
import type { ApiError } from '@/api/client';

export type SearchKind = NonNullable<SearchFilters['kind']>;

export interface SearchHit {
  id: string;
  kind: SearchKind;
  cityId: string;
  createdAt: string;
  rank: number | null;
  title: string;
}

const SEARCH_LIMIT = 20;

/**
 * `q` may be undefined while the user is still typing — the screen layer
 * debounces and then supplies a non-empty value. When `enabled` is false,
 * no request is fired and `data` stays undefined.
 */
export function useSearch(
  filters: SearchFilters & { q: string | undefined },
  options: { enabled?: boolean } = {},
) {
  const q = filters.q?.trim() ?? '';
  const enabled = options.enabled ?? q.length > 0;
  return useQuery<SearchHit[], ApiError>({
    queryKey: queryKeys.search(filters),
    enabled,
    queryFn: async (): Promise<SearchHit[]> => {
      const params = new URLSearchParams();
      params.set('q', q);
      if (filters.city_id) params.set('cityId', filters.city_id);
      if (filters.neighborhood_id) params.set('neighborhoodId', filters.neighborhood_id);
      if (filters.kind) params.set('kind', filters.kind);
      params.set('limit', String(SEARCH_LIMIT));
      const r = await apiClient.get<SearchHit[]>(`/search?${params}`);
      return r.data;
    },
    staleTime: 30_000,
  });
}
