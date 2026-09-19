// src/api/notifications.ts
import { apiClient } from './client';

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.patch(`/notifications/${id}/read`);
}
