import { QueryClient } from '@tanstack/react-query';
// ponytail: stub for Phase 8; Phase 6 will fill in defaultOptions + MMKV persister
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});