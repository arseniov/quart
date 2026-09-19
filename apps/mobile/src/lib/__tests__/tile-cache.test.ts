// src/lib/__tests__/tile-cache.test.ts
// GH #22 — exercises the pure helpers + the deps seam. The native FS is mocked at the
// `expo-file-system` module boundary so tests run in jest-expo without native bindings.

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

jest.mock('expo-file-system', () => {
  // ponytail: in-memory fs mock. The trick is keeping the same Directory instance
  //          for a given URI across `new Directory(parent, 'name')` constructions;
  //          without that, the cache's lookup-by-uri misses. We key the registry
  //          by uri string so any subsequent construction returns the same object.
  type MockFsFile = { uri: string; content: string; size: number; exists: boolean };
  type MockFsDir = { uri: string; exists: boolean; children: Map<string, MockFsFile | MockFsDir> };

  const state = {
    dirs: new Map<string, MockFsDir>(),
    files: new Map<string, MockFsFile>(),
    availableDiskSpace: 1_000_000_000,
  };

  function ensureDir(uri: string): MockFsDir {
    let d = state.dirs.get(uri);
    if (!d) {
      d = { uri, exists: true, children: new Map() };
      state.dirs.set(uri, d);
    }
    return d;
  }

  function ensureFile(uri: string): MockFsFile {
    let f = state.files.get(uri);
    if (!f) {
      f = { uri, content: '', size: 0, exists: true };
      state.files.set(uri, f);
    }
    return f;
  }

  class FakeFile {
    public uri: string;
    constructor(...mockUris: (string | FakeDirectory)[]) {
      if (mockUris.length === 0) {
        this.uri = '';
        return;
      }
      const first = mockUris[0]!;
      const rest = mockUris.slice(1);
      const base = typeof first === 'string' ? first : first.uri;
      this.uri = rest.length === 0 ? base : `${base.replace(/\/$/, '')}/${rest.join('/')}`;
    }
    get name() {
      return this.uri.split('/').pop() ?? '';
    }
    get exists(): boolean {
      return state.files.get(this.uri)?.exists ?? false;
    }
    create() {
      ensureFile(this.uri);
    }
    write(value: string) {
      const f = ensureFile(this.uri);
      f.content = value;
      f.size = value.length;
    }
    text(): Promise<string> {
      return Promise.resolve(state.files.get(this.uri)?.content ?? '');
    }
    get size(): number {
      return state.files.get(this.uri)?.size ?? 0;
    }
    delete() {
      state.files.delete(this.uri);
    }
  }

  class FakeDirectory {
    public uri: string;
    constructor(...parts: (string | FakeDirectory)[]) {
      if (parts.length === 0) {
        this.uri = '';
        return;
      }
      const first = parts[0]!;
      const rest = parts.slice(1);
      const base = typeof first === 'string' ? first : first.uri;
      this.uri = rest.length === 0 ? base : `${base.replace(/\/$/, '')}/${rest.join('/')}`;
    }
    get name() {
      return this.uri.split('/').pop() ?? '';
    }
    get exists(): boolean {
      const parentUri = this.uri.split('/').slice(0, -1).join('/');
      const parent = state.dirs.get(parentUri);
      if (!parent) return state.dirs.has(this.uri);
      return parent.children.has(this.name);
    }
    create(options?: { intermediates?: boolean }) {
      const parentUri = this.uri.split('/').slice(0, -1).join('/');
      const name = this.uri.split('/').pop() ?? '';
      if (options?.intermediates && parentUri) {
        const segments = parentUri.split('/').filter(Boolean);
        let acc = segments[0]?.startsWith('file:') ? `${segments[0]}/` : '/';
        for (let i = segments[0]?.startsWith('file:') ? 1 : 0; i < segments.length; i++) {
          acc = `${acc.replace(/\/$/, '')}/${segments[i]}`;
          ensureDir(acc);
        }
      }
      const parent = state.dirs.get(parentUri);
      if (!parent) {
        const d = ensureDir(this.uri);
        d.exists = true;
        return;
      }
      const child = ensureDir(this.uri);
      parent.children.set(name, child);
      child.exists = true;
    }
    delete() {
      const parentUri = this.uri.split('/').slice(0, -1).join('/');
      const name = this.uri.split('/').pop() ?? '';
      const parent = state.dirs.get(parentUri);
      if (parent) parent.children.delete(name);
      // ponytail: shallow delete — bundle contents are mocked as the manifest.json only,
      //          so we don't recurse. A more realistic fs would walk `children`.
      state.dirs.delete(this.uri);
      const manifestUri = `${this.uri}/manifest.json`;
      state.files.delete(manifestUri);
    }
    list(): (FakeFile | FakeDirectory)[] {
      const dir = state.dirs.get(this.uri);
      if (!dir) return [];
      const out: (FakeFile | FakeDirectory)[] = [];
      for (const child of dir.children.values()) {
        if ('children' in child) {
          out.push(new FakeDirectory(child.uri));
        } else {
          out.push(new FakeFile(child.uri));
        }
      }
      return out;
    }
  }

  const documentDir = new FakeDirectory('file:///document');
  const cacheRoot = new FakeDirectory('file:///document/tiles');
  documentDir.create();
  cacheRoot.create();

  return {
    Paths: {
      get document() {
        return documentDir;
      },
      get cache() {
        return new FakeDirectory('file:///cache');
      },
      get bundle() {
        return new FakeDirectory('file:///bundle');
      },
      get availableDiskSpace() {
        return state.availableDiskSpace;
      },
      set availableDiskSpace(v: number) {
        state.availableDiskSpace = v;
      },
    },
    Directory: FakeDirectory,
    File: FakeFile,
    __resetFileState: () => {
      state.dirs.clear();
      state.files.clear();
      state.availableDiskSpace = 1_000_000_000;
      documentDir.create();
      cacheRoot.create();
    },
    __getState: () => state,
    __cache: cacheRoot,
  };
});

import NetInfo from '@react-native-community/netinfo';
import {
  slugify,
  downloadCityArea,
  readManifest,
  listBundles,
  evictOldest,
  ensureFreeSpace,
  canDownloadOnCurrentNetwork,
  formatBytes,
  getStorageStats,
  getCacheDir,
  getBundleDir,
  deleteCityArea,
  type Deps,
} from '../tile-cache';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('expo-file-system') as {
  __resetFileState: () => void;
  __getState: () => { dirs: Map<string, unknown>; files: Map<string, unknown>; availableDiskSpace: number };
  __cache: { uri: string };
  Paths: { document: { uri: string }; availableDiskSpace: number };
};

type FakeDir = {
  uri: string;
  exists: boolean;
  list: () => unknown[];
  create: (opts?: { intermediates?: boolean }) => void;
  delete: () => void;
  name: string;
};
type FakeFile = {
  uri: string;
  content: string;
  size: number;
  exists: boolean;
  text: () => string;
  write: (v: string) => void;
  create: () => void;
  name: string;
};

function buildDeps(overrides: Partial<Deps> = {}): Deps {
  const baseDeps: Deps = {
    cacheDir: fsMock.__cache as unknown as Deps['cacheDir'],
    listSubdirectories: (dir) => (dir.list() as unknown as FakeDir[]).filter((e) => !('content' in e)) as unknown as Deps['cacheDir'][],
    readJsonFile: async <T>(file: unknown) => {
      const f = file as FakeFile;
      const text = await f.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    writeJsonFile: async (file, value) => {
      const f = file as unknown as FakeFile;
      f.create();
      f.write(JSON.stringify(value));
    },
    deleteDirectory: (dir) => {
      if ((dir as unknown as FakeDir).exists) (dir as unknown as FakeDir).delete();
    },
    computeSize: (dir) => {
      const d = dir as unknown as FakeDir;
      if (!d.exists) return 0;
      let total = 0;
      for (const entry of d.list() as unknown as FakeFile[]) {
        total += entry.size;
      }
      return total;
    },
    availableDiskSpace: () => fsMock.Paths.availableDiskSpace,
  };
  return { ...baseDeps, ...overrides };
}

beforeEach(() => {
  fsMock.__resetFileState();
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true });
});

describe('slugify', () => {
  it('replaces spaces and punctuation with hyphens', () => {
    expect(slugify('Milano — Centro Storico')).toBe('milano-centro-storico');
  });
  it('lowercases and trims leading/trailing hyphens', () => {
    expect(slugify('  Roma Nord  ')).toBe('roma-nord');
  });
  it('returns the empty string for non-alphanumeric input', () => {
    expect(slugify('   ')).toBe('');
  });
});

describe('getCacheDir / getBundleDir', () => {
  it('returns a Directory rooted under Paths.document', () => {
    const deps = buildDeps();
    const cache = getCacheDir(deps);
    const bundle = getBundleDir('Milano Centro', deps);
    expect(cache.uri).toContain(fsMock.Paths.document.uri);
    expect(bundle.uri).toContain('milano-centro');
  });
});

describe('downloadCityArea', () => {
  it('creates the bundle directory, writes manifest, returns size', async () => {
    const deps = buildDeps();
    const manifest = await downloadCityArea(
      'roma',
      { west: 12.4, south: 41.8, east: 12.6, north: 42.0 },
      {
        fetchTiles: async (_dir, _bounds, onProgress) => {
          onProgress({ bytesDownloaded: 5, totalBytes: 10 });
          return { sizeBytes: 24_000_000 };
        },
      },
      deps,
    );

    expect(manifest.cityAreaId).toBe('roma');
    expect(manifest.sizeBytes).toBe(24_000_000);
    expect(typeof manifest.downloadedAt).toBe('string');

    const read = await readManifest('roma', deps);
    expect(read).toEqual(manifest);
  });

  it('clears the bundle directory before re-downloading', async () => {
    const deps = buildDeps();
    await downloadCityArea(
      'napoli',
      { west: 14, south: 40, east: 15, north: 41 },
      { fetchTiles: async () => ({ sizeBytes: 100 }) },
      deps,
    );
    await downloadCityArea(
      'napoli',
      { west: 14, south: 40, east: 15, north: 41 },
      { fetchTiles: async () => ({ sizeBytes: 200 }) },
      deps,
    );
    expect((await readManifest('napoli', deps))?.sizeBytes).toBe(200);
  });

  it('forwards progress events from fetchTiles', async () => {
    const deps = buildDeps();
    const progress = jest.fn();
    await downloadCityArea(
      'bari',
      { west: 16, south: 41, east: 17, north: 42 },
      {
        fetchTiles: async (_dir, _b, onProgress) => {
          onProgress({ bytesDownloaded: 25, totalBytes: 100 });
          onProgress({ bytesDownloaded: 100, totalBytes: 100 });
          return { sizeBytes: 1024 };
        },
        onProgress: progress,
      },
      deps,
    );
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith({ bytesDownloaded: 100, totalBytes: 100 });
  });
});

describe('listBundles + getStorageStats', () => {
  it('lists previously downloaded bundles with their manifests', async () => {
    const deps = buildDeps();
    await downloadCityArea(
      'firenze',
      { west: 11, south: 43, east: 12, north: 44 },
      { fetchTiles: async () => ({ sizeBytes: 30_000_000 }) },
      deps,
    );
    await downloadCityArea(
      'torino',
      { west: 7, south: 45, east: 8, north: 46 },
      { fetchTiles: async () => ({ sizeBytes: 10_000_000 }) },
      deps,
    );

    const stats = await getStorageStats(deps);
    expect(stats.bundleCount).toBe(2);
    expect(stats.totalBytes).toBe(40_000_000);
    expect(stats.bundles.map((b) => b.id).sort()).toEqual(['firenze', 'torino']);
  });

  it('returns empty stats when nothing is cached', async () => {
    const stats = await getStorageStats(buildDeps());
    expect(stats.bundleCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });
});

describe('deleteCityArea', () => {
  it('removes the bundle directory and its manifest', async () => {
    const deps = buildDeps();
    await downloadCityArea(
      'genova',
      { west: 8, south: 44, east: 9, north: 45 },
      { fetchTiles: async () => ({ sizeBytes: 1024 }) },
      deps,
    );
    expect(await readManifest('genova', deps)).not.toBeNull();

    deleteCityArea('genova', deps);
    expect(await readManifest('genova', deps)).toBeNull();
    expect((await listBundles(deps))).toHaveLength(0);
  });

  it('is a no-op for an unknown city', () => {
    expect(() => deleteCityArea('never-cached', buildDeps())).not.toThrow();
  });
});

describe('evictOldest', () => {
  it('evicts the bundle with the earliest downloadedAt', async () => {
    const deps = buildDeps();
    const originalNow = Date.now;
    let t = 1_700_000_000_000;
    Date.now = () => t;
    try {
      await downloadCityArea(
        'a',
        { west: 0, south: 0, east: 1, north: 1 },
        { fetchTiles: async () => ({ sizeBytes: 1 }) },
        deps,
      );
      t += 1000;
      await downloadCityArea(
        'b',
        { west: 0, south: 0, east: 1, north: 1 },
        { fetchTiles: async () => ({ sizeBytes: 1 }) },
        deps,
      );
      t += 1000;
      await downloadCityArea(
        'c',
        { west: 0, south: 0, east: 1, north: 1 },
        { fetchTiles: async () => ({ sizeBytes: 1 }) },
        deps,
      );

      const evicted = await evictOldest(deps);
      expect(evicted?.id).toBe('a');
      expect((await listBundles(deps)).map((b) => b.id)).toEqual(['b', 'c']);
    } finally {
      Date.now = originalNow;
    }
  });

  it('returns null when there is nothing to evict', async () => {
    expect(await evictOldest(buildDeps())).toBeNull();
  });
});

describe('ensureFreeSpace', () => {
  it('evicts the oldest bundles until free space exceeds the target', async () => {
    const deps = buildDeps();
    await downloadCityArea(
      'a',
      { west: 0, south: 0, east: 1, north: 1 },
      { fetchTiles: async () => ({ sizeBytes: 30_000_000 }) },
      deps,
    );
    let calls = 0;
    deps.availableDiskSpace = () => {
      calls += 1;
      return calls === 1 ? 50_000_000 : 500_000_000;
    };
    await ensureFreeSpace(200 * 1_000_000, deps);
    expect((await listBundles(deps))).toHaveLength(0);
  });

  it('does not over-evict when free space is already healthy', async () => {
    const deps = buildDeps();
    await downloadCityArea(
      'a',
      { west: 0, south: 0, east: 1, north: 1 },
      { fetchTiles: async () => ({ sizeBytes: 1 }) },
      deps,
    );
    await ensureFreeSpace(200 * 1_000_000, deps);
    expect((await listBundles(deps))).toHaveLength(1);
  });
});

describe('canDownloadOnCurrentNetwork', () => {
  it('returns true when online and Wi-Fi', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
    const gate = { allowCellular: false, isMetered: async () => false };
    expect(await canDownloadOnCurrentNetwork(gate)).toBe(true);
  });

  it('returns false when offline', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: false, isInternetReachable: false });
    expect(await canDownloadOnCurrentNetwork({ allowCellular: true, isMetered: async () => false })).toBe(false);
  });

  it('blocks metered connections unless opted in', async () => {
    (NetInfo.fetch as jest.Mock).mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
    const wifiOnly = await canDownloadOnCurrentNetwork({ allowCellular: false, isMetered: async () => true });
    expect(wifiOnly).toBe(false);

    const cellular = await canDownloadOnCurrentNetwork({ allowCellular: true, isMetered: async () => true });
    expect(cellular).toBe(true);
  });
});

describe('formatBytes', () => {
  it('renders KB for sub-megabyte sizes', () => {
    expect(formatBytes(500_000)).toBe('500 KB');
  });
  it('renders single-decimal MB under 10 MB', () => {
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });
  it('rounds to integer MB above 10 MB', () => {
    expect(formatBytes(24_000_000)).toBe('24 MB');
  });
});