import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { mmkvStorage } from '@/lib/storage';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24, // 24h — keep for offline reads
      networkMode: 'offlineFirst',
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: 'online',
      retry: 1,
    },
  },
});

export const persister = createSyncStoragePersister({
  storage: mmkvStorage,
  key: 'quart.tanstack.cache.v1',
  throttleTime: 1000,
});

export const queryKeys = {
  me: () => ['me'] as const,
  cities: (country: string) => ['cities', country] as const,
  topics: () => ['topics'] as const,
  feed: (filters: unknown) => ['feed', filters] as const,
  polls: (filters: unknown) => ['polls', filters] as const,
  poll: (id: string) => ['poll', id] as const,
  issues: (filters: unknown) => ['issues', filters] as const,
  issue: (id: string) => ['issue', id] as const,
  issueCategories: () => ['issue-categories'] as const,
  ideas: (filters: unknown) => ['ideas', filters] as const,
  idea: (id: string) => ['idea', id] as const,
  ideaComments: (ideaId: string) => ['idea-comments', ideaId] as const,
  ideaComment: (ideaId: string, commentId: string) =>
    ['idea-comments', ideaId, commentId] as const,
  notifications: () => ['notifications'] as const,
  saved: () => ['saved-items'] as const,
  neighborhoods: (cityId: string | undefined) => ['neighborhoods', cityId] as const,
  topicSubscriptions: () => ['me', 'topic-subscriptions'] as const,
  mapMarkers: (cityId: string | undefined) => ['map', 'markers', cityId] as const,
} as const;