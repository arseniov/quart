import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface Me {
  id: string;
  handle: string;
  display_name: string;
  email: string | null;
  phone_e164: string | null;
  avatar_url: string | null;
  preferred_locale: string;
  city_id: string;
  needs_onboarding: boolean;
  roles: string[];
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: async () => {
      const r = await apiClient.get<Me>('/me');
      return r.data;
    },
    staleTime: 60_000,
  });
}
