// src/components/issue/IssueMap.tsx
import { useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { osmStyle } from '@/lib/map-style';
import { tokens } from '@/theme/tokens';
import type { MapMarker } from '@/api/hooks/useMapMarkers';
import { OfflineDownloadButton } from './OfflineDownloadButton';

// ponytail: hardcoded fallback until Phase 12+ hooks this to the user's selected city (useMe.city_id → geocode)
export const DEFAULT_CITY_CENTER: [number, number] = [12.4964, 41.9028]; // Rome
const DEFAULT_ZOOM = 11;

function markerColor(kind: MapMarker['kind']): string {
  // semantic tokens are flat strings (error/info), not {light,dark}
  return kind === 'issue' ? tokens.color.error : tokens.color.info;
}

export function IssueMap({
  markers,
  initialCenter,
  cityAreaId,
}: {
  markers: MapMarker[];
  initialCenter?: [number, number];
  cityAreaId?: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<MapMarker | null>(null);
  const center = initialCenter ?? DEFAULT_CITY_CENTER;

  return (
    <View className="flex-1">
      <Map
        style={{ flex: 1 }}
        mapStyle={osmStyle}
        onPress={() => setSelected(null)}
      >
        <Camera
          initialViewState={{
            zoom: DEFAULT_ZOOM,
            center: center,
          }}
        />
        {markers.map((m) => (
          <Marker
            key={`${m.kind}-${m.id}`}
            id={`${m.kind}-${m.id}`}
            lngLat={[m.lng, m.lat]}
            onPress={() => setSelected(m)}
          >
            <View
              accessibilityRole="button"
              accessibilityLabel={m.title}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: markerColor(m.kind),
                borderWidth: 2,
                borderColor: tokens.color.bg.light,
              }}
            />
          </Marker>
        ))}
      </Map>
      {cityAreaId && (
        <OfflineDownloadButton cityAreaId={cityAreaId} />
      )}
      {selected && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/${selected.kind}/${selected.id}`)}
          className="absolute bottom-6 left-4 right-4 bg-surface border border-border rounded-md p-3"
        >
          <Text className="text-text-secondary text-xs uppercase">
            {t(`map.${selected.kind}`)}
          </Text>
          <Text className="text-text-primary font-semibold">{selected.title}</Text>
        </Pressable>
      )}
    </View>
  );
}