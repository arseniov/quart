import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface City { id: string; slug: string; name: string; country_code: string }

export function useCities(country = 'IT') {
  return useQuery({
    queryKey: queryKeys.cities(country),
    queryFn: async () => {
      const r = await apiClient.get<{ cities: City[] }>(`/cities?country=${country}`);
      return r.data.cities;
    },
    staleTime: 60 * 60 * 1000,
  });
}