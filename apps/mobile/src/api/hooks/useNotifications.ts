// src/api/hooks/useNotifications.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  target_url: z.string().nullable(),
  read_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: async () => {
      const r = await apiClient.get<{ notifications: Notification[] }>(`/me/notifications`);
      return r.data.notifications;
    },
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/me/notifications/${id}/read`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.notifications() });
      const prev = qc.getQueryData<Notification[]>(queryKeys.notifications());
      qc.setQueryData<Notification[]>(queryKeys.notifications(), (old) =>
        old?.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)) ?? [],
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.notifications(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.notifications() }),
  });
}
