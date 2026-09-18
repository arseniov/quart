// src/api/hooks/useMapMarkers.ts
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';

export const MapMarkerSchema = z.object({
  id: z.string(),
  kind: z.enum(['issue', 'poll']),
  lat: z.number(),
  lng: z.number(),
  title: z.string(),
});
export type MapMarker = z.infer<typeof MapMarkerSchema>;

export function useMapMarkers(cityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mapMarkers(cityId),
    enabled: !!cityId,
    queryFn: async () => {
      const r = await apiClient.get<{ markers: MapMarker[] }>(
        `/map/markers?city_id=${encodeURIComponent(cityId!)}`,
      );
      return r.data.markers;
    },
    staleTime: 60_000,
  });
}
