// src/api/hooks/useIssue.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import { IssueCreateSchema } from '@quart/shared-types';

export const IssueEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.enum(['created', 'status_changed', 'assigned', 'commented', 'photo_added']),
  actor_handle: z.string(),
  payload: z.record(z.unknown()),
  created_at: z.string().datetime(),
});

export const IssueSchema = z.object({
  id: z.string().uuid(),
  city_id: z.string().uuid(),
  neighborhood_id: z.string().uuid(),
  category_id: z.string().uuid(),
  author_user_id: z.string().uuid(),
  title: z.string().nullable(),
  description: z.string(),
  status: z.enum(['open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected']),
  status_changed_at: z.string().datetime(),
  sla_due_at: z.string().datetime().nullable(),
  lat: z.number(),
  lng: z.number(),
  address_hint: z.string().nullable(),
  photo_urls: z.array(z.string().url()).default([]),
  created_at: z.string().datetime(),
});
export type Issue = z.infer<typeof IssueSchema>;

export function useIssue(id: string) {
  return useQuery({
    queryKey: queryKeys.issue(id),
    queryFn: async () => {
      const r = await apiClient.get<{
        issue: Issue;
        events: z.infer<typeof IssueEventSchema>[];
      }>(`/issues/${id}`);
      return r.data;
    },
    staleTime: 30_000,
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: z.infer<typeof IssueCreateSchema>) => {
      const r = await apiClient.post<{ issue: Issue }>(`/issues`, input);
      return r.data.issue;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
