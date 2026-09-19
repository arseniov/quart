// src/components/issue/OfflineDownloadButton.tsx
// GH #22 — "Download map for offline" affordance on the map tab.
// ponytail: button state machine is intentionally simple — one of
//          {idle, downloading, downloaded, failed, meteredBlocked, noConnection}.
//          A future cancel/retry flow can layer on top; for now the user re-taps to retry.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { minHitSlop } from '@/a11y/hit-slop';
import {
  downloadCityArea,
  readManifest,
  canDownloadOnCurrentNetwork,
  ensureFreeSpace,
} from '@/lib/tile-cache';
import { File } from 'expo-file-system';
import { osmStyle } from '@/lib/map-style';

type Status =
  | 'idle'
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'meteredBlocked'
  | 'noConnection';

const CITY_BOUNDS = { west: 12.4, south: 41.8, east: 12.6, north: 42.0 }; // ponytail: hardcoded until geocoding lands; same fallback as IssueMap.

export function OfflineDownloadButton({ cityAreaId }: { cityAreaId: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    void readManifest(cityAreaId).then((m) => {
      if (m) setStatus('downloaded');
    });
  }, [cityAreaId]);

  const onPress = useCallback(async () => {
    if (status === 'downloading' || status === 'downloaded') return;
    // ponytail: probe connectivity directly so we can split "no connection" from "metered"
    //          — `canDownloadOnCurrentNetwork` collapses both into a single `false`.
    const netState = await NetInfo.fetch();
    const reachable = netState.isConnected !== false && netState.isInternetReachable !== false;
    if (!reachable) {
      setStatus('noConnection');
      return;
    }
    const allowed = await canDownloadOnCurrentNetwork();
    if (!allowed) {
      setStatus('meteredBlocked');
      return;
    }
    setStatus('downloading');
    setPercent(0);
    try {
      await ensureFreeSpace();
      await downloadCityArea(cityAreaId, CITY_BOUNDS, {
        onProgress: (p) => {
          if (p.totalBytes > 0) setPercent(Math.round((p.bytesDownloaded / p.totalBytes) * 100));
        },
        fetchTiles: async (bundleDir, bounds, onProgress) => {
          // ponytail: MapLibre v11 expects `bounds` as a flat [west, south, east, north] tuple
          //          (see `LngLatBounds`) and BOTH listener args are required even if you only
          //          use one. The percentage field is already 0-100, so we forward it as bytes/100
          //          to keep the existing progress wiring.
          // ponytail: native OfflineManager owns the tile DB outside `bundleDir`, so the on-disk
          //          bundle dir is empty. We persist `status.completedResourceSize` to
          //          `bundleDir/manifest.json` as a transient estimate so the storage badge has
          //          a real byte count even before `downloadCityArea` writes the final manifest.
          let lastSizeBytes = 0;
          const transientManifest = new File(bundleDir, 'manifest.json');
          await OfflineManager.createPack(
            {
              mapStyle: osmStyle,
              bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
              minZoom: 10,
              maxZoom: 18,
            },
            (_pack, status) => {
              onProgress({ bytesDownloaded: status.percentage, totalBytes: 100 });
              lastSizeBytes = status.completedResourceSize;
              transientManifest.create({ intermediates: true, overwrite: true });
              transientManifest.write(JSON.stringify({ sizeBytes: lastSizeBytes }));
            },
            (_pack, error) => {
              // ponytail: error listener fires after createPack has resolved; a throw here
              //          becomes an unhandled rejection. Surface to the logger so Sentry picks
              //          it up — the user retries by tapping again.
              console.error('[OfflineDownloadButton] pack error', error);
            },
          );
          return { sizeBytes: lastSizeBytes };
        },
      });
      setStatus('downloaded');
    } catch {
      setStatus('failed');
    }
  }, [status, cityAreaId]);

  const label = (() => {
    switch (status) {
      case 'downloaded':
        return t('map.offline.downloaded');
      case 'downloading':
        return t('map.offline.downloading', { percent });
      case 'failed':
        return t('map.offline.failed');
      case 'noConnection':
        return t('map.offline.noConnection');
      case 'meteredBlocked':
        return t('map.offline.meteredBlocked');
      case 'idle':
      default:
        return t('map.offline.download');
    }
  })();

  return (
    <View className="absolute top-4 right-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        hitSlop={minHitSlop()}
        className="bg-surface border border-border rounded-full px-3 py-2 shadow"
      >
        <Text className="text-text-primary text-xs font-semibold">{label}</Text>
      </Pressable>
    </View>
  );
}