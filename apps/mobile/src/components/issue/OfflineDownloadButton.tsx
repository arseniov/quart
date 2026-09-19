// src/components/issue/OfflineDownloadButton.tsx
// GH #22 — "Download map for offline" affordance on the map tab.
// ponytail: button state machine is intentionally simple — one of {idle, downloading, downloaded, failed, meteredBlocked}.
//          A future cancel/retry flow can layer on top; for now the user re-taps to retry.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { minHitSlop } from '@/a11y/hit-slop';
import {
  downloadCityArea,
  readManifest,
  deleteCityArea,
  canDownloadOnCurrentNetwork,
  ensureFreeSpace,
} from '@/lib/tile-cache';

type Status = 'idle' | 'downloading' | 'downloaded' | 'failed' | 'meteredBlocked';

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
    if (status === 'downloaded') {
      deleteCityArea(cityAreaId);
      setStatus('idle');
      return;
    }
    if (status === 'downloading') return;
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
        fetchTiles: async (_dir, _bounds, onProgress) => {
          // ponytail: real impl uses OfflineManager.createPack; for now we simulate progress.
          //          Wire to native OfflineManager.createPack once EAS Build is provisioned.
          onProgress({ bytesDownloaded: 25, totalBytes: 100 });
          onProgress({ bytesDownloaded: 60, totalBytes: 100 });
          onProgress({ bytesDownloaded: 100, totalBytes: 100 });
          return { sizeBytes: 24_000_000 };
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