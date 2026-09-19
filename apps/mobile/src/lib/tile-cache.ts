// src/lib/tile-cache.ts
// GH #22 — per-city-area offline map tile cache.
// Side-effect boundaries: every network/fs call is funneled through `deps` so tests
// can substitute in-memory fakes. Pure functions (size math, slug, manifest shape)
// live outside `deps`.
//
// ponytail: MapLibre v11 uses `OfflineManager.createPack`; the `tileCachePath` property
//          mentioned in GH #22 belongs to `@rnmapbox/maps` and is not applicable here.
// ponytail: storage math uses 1 MB = 1_000_000 bytes (SI), not 1_048_576 (binary).
//          Settings badge mirrors the system Settings → Storage convention; flip to
//          binary if a future "show exact bytes" toggle lands.

import { Paths, Directory, File } from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

export type CityBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type TileBundleManifest = {
  cityAreaId: string;
  downloadedAt: string;
  sizeBytes: number;
};

export type BundleInfo = TileBundleManifest & { id: string };

export type DownloadProgress = {
  bytesDownloaded: number;
  totalBytes: number;
};

export type Deps = {
  cacheDir: Directory;
  listSubdirectories: (dir: Directory) => Directory[];
  readJsonFile: <T>(file: File) => Promise<T | null>;
  writeJsonFile: (file: File, value: unknown) => Promise<void>;
  deleteDirectory: (dir: Directory) => void;
  computeSize: (dir: Directory) => number;
  availableDiskSpace: () => number;
};

const MB = 1_000_000;
const LOW_STORAGE_BYTES = 100 * MB;
const TARGET_FREE_BYTES = 200 * MB;

function defaultDeps(): Deps {
  return {
    cacheDir: new Directory(Paths.document, 'tiles'),
    // ponytail: duck-type on `list`/`create` rather than `instanceof Directory` so mocks
    //          with the same shape (Directory-like api) flow through. `e.uri` distinguishes
    //          files from dirs without needing constructor identity.
    listSubdirectories: (dir) => dir.list().filter((e): e is Directory => typeof (e as Directory).list === 'function' && typeof (e as { uri?: unknown }).uri === 'string'),
    readJsonFile: async <T>(file: File) => {
      try {
        return JSON.parse(await file.text()) as T;
      } catch {
        return null;
      }
    },
    writeJsonFile: async (file, value) => {
      file.create({ intermediates: true, overwrite: true });
      file.write(JSON.stringify(value));
    },
    deleteDirectory: (dir) => {
      if (dir.exists) dir.delete();
    },
    computeSize: (dir) => {
      if (!dir.exists) return 0;
      let total = 0;
      for (const entry of dir.list()) {
        const e = entry as Directory;
        if (typeof e.list === 'function' && typeof (e as { uri?: unknown }).uri === 'string') {
          total += computeSizeRecursive(e);
        } else {
          total += (entry as File).size ?? 0;
        }
      }
      return total;
    },
    availableDiskSpace: () => Paths.availableDiskSpace,
  };
}

// ponytail: recursive helper extracted from the default computeSize closure so tests can
//          reuse it; non-default impls (test fakes) must implement their own recursion.
function computeSizeRecursive(dir: Directory): number {
  let total = 0;
  for (const entry of dir.list()) {
    const e = entry as Directory;
    if (typeof e.list === 'function' && typeof (e as { uri?: unknown }).uri === 'string') {
      total += computeSizeRecursive(e);
    } else {
      total += (entry as File).size ?? 0;
    }
  }
  return total;
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function getCacheDir(deps: Deps = defaultDeps()): Directory {
  return deps.cacheDir;
}

export function getBundleDir(cityAreaId: string, deps: Deps = defaultDeps()): Directory {
  return new Directory(deps.cacheDir, slugify(cityAreaId));
}

export async function readManifest(cityAreaId: string, deps: Deps = defaultDeps()): Promise<TileBundleManifest | null> {
  const manifestFile = new File(getBundleDir(cityAreaId, deps), 'manifest.json');
  return deps.readJsonFile<TileBundleManifest>(manifestFile);
}

export async function listBundles(deps: Deps = defaultDeps()): Promise<BundleInfo[]> {
  if (!deps.cacheDir.exists) return [];
  const out: BundleInfo[] = [];
  for (const sub of deps.listSubdirectories(deps.cacheDir)) {
    const manifestFile = new File(sub, 'manifest.json');
    const manifest = await deps.readJsonFile<TileBundleManifest>(manifestFile);
    if (manifest) {
      out.push({ id: manifest.cityAreaId, ...manifest });
    }
  }
  return out;
}

export type DownloadOptions = {
  onProgress?: (p: DownloadProgress) => void;
  // ponytail: tile transport is delegated to the native OfflineManager; the JS helper
  //          only manages the manifest. The native side owns the actual tile bytes.
  fetchTiles: (
    bundleDir: Directory,
    bounds: CityBounds,
    onProgress: (p: DownloadProgress) => void,
  ) => Promise<{ sizeBytes: number }>;
};

export async function downloadCityArea(
  cityAreaId: string,
  bounds: CityBounds,
  options: DownloadOptions,
  deps: Deps = defaultDeps(),
): Promise<TileBundleManifest> {
  const bundleDir = getBundleDir(cityAreaId, deps);
  deps.deleteDirectory(bundleDir);
  bundleDir.create({ intermediates: true });
  const { sizeBytes } = await options.fetchTiles(bundleDir, bounds, (p) => options.onProgress?.(p));
  const manifest: TileBundleManifest = {
    cityAreaId,
    downloadedAt: new Date().toISOString(),
    sizeBytes,
  };
  await deps.writeJsonFile(new File(bundleDir, 'manifest.json'), manifest);
  return manifest;
}

export function deleteCityArea(cityAreaId: string, deps: Deps = defaultDeps()): void {
  deps.deleteDirectory(getBundleDir(cityAreaId, deps));
}

// ponytail: LRU is approximated by oldest `downloadedAt`; no per-access tracking.
//          Upgrade to a real recency counter if eviction choices start feeling wrong.
export async function evictOldest(deps: Deps = defaultDeps()): Promise<BundleInfo | null> {
  const bundles = (await listBundles(deps)).sort((a, b) => a.downloadedAt.localeCompare(b.downloadedAt));
  const victim = bundles[0];
  if (!victim) return null;
  deleteCityArea(victim.id, deps);
  return victim;
}

export async function ensureFreeSpace(targetBytes: number = TARGET_FREE_BYTES, deps: Deps = defaultDeps()): Promise<void> {
  while (deps.availableDiskSpace() < Math.max(targetBytes, LOW_STORAGE_BYTES) && (await listBundles(deps)).length > 0) {
    const evicted = await evictOldest(deps);
    if (!evicted) break;
  }
}

export type ConnectivityGate = {
  allowCellular: boolean;
  isMetered: () => Promise<boolean>;
};

// ponytail: we refuse the download if metered+!allowCellular. isMetered() probes NetInfo once;
//          a state change mid-download is the caller's problem (resume / cancel).
export async function canDownloadOnCurrentNetwork(gate: ConnectivityGate = { allowCellular: false, isMetered: async () => false }): Promise<boolean> {
  const state = await NetInfo.fetch();
  const reachable = state.isConnected !== false && state.isInternetReachable !== false;
  if (!reachable) return false;
  if (!state.isConnected) return false;
  if (gate.allowCellular) return true;
  return !(await gate.isMetered());
}

export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
}

export type StorageStats = {
  bundleCount: number;
  totalBytes: number;
  bundles: BundleInfo[];
};

export async function getStorageStats(deps: Deps = defaultDeps()): Promise<StorageStats> {
  const bundles = await listBundles(deps);
  return {
    bundleCount: bundles.length,
    totalBytes: bundles.reduce((sum, b) => sum + b.sizeBytes, 0),
    bundles,
  };
}

// ponytail: MapLibre v11 `OfflinePack` exposes no `getSize()` and the native OfflineManager
//          owns its tile DB outside our `bundleDir`. The transient `sizeBytes` is recorded in
//          `manifest.json` by `OfflineDownloadButton.fetchTiles` from progress events.