import { QueryClient } from '@tanstack/react-query';
// ponytail: defaultOptions set here for Phase 8; Phase 6 adds MMKV persister + per-mutation options
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});