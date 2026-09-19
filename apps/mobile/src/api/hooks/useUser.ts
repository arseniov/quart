// src/api/hooks/useUser.ts
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/api/client';
import type { ApiError } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export interface PublicUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: string;
  publicStats: {
    ideasCount: number;
    issuesCount: number;
    pollsCount: number;
  };
}

/**
 * Public profile lookup — `GET /users/:id`. The server returns a strict
 * field whitelist (no email, phone, votes, audit); the DTO is sanitized.
 *
 * Error behavior:
 *   - 404  → user-not-found; surfaced via `error.status` (ApiError).
 *   - 410  → soft-deleted user; surfaced via `error.status` (ApiError).
 *   - any other non-2xx  → surfaces as-is (network / 5xx / throttled).
 *
 * Note: the previous decision to swallow 404 into `null` was rejected —
 * 410 (deleted) and 404 (never existed) carry different meanings and
 * conflating them would hide legitimate outages.
 */
export function useUser(id: string | undefined) {
  return useQuery<PublicUser, ApiError>({
    queryKey: id ? queryKeys.user(id) : ['user', 'disabled'],
    enabled: Boolean(id),
    queryFn: async (): Promise<PublicUser> => {
      const r = await apiClient.get<PublicUser>(`/users/${encodeURIComponent(id!)}`);
      return r.data;
    },
    staleTime: 60_000,
  });
}
