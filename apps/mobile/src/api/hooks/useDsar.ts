// src/api/hooks/useDsar.ts
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export type DsarType = 'export' | 'delete';

export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiClient.post<{ request_id: string }>('/me/dsar', { type: 'export' });
      return r.data;
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const r = await apiClient.post<{ request_id: string }>('/me/dsar', { type: 'delete' });
      return r.data;
    },
  });
}
