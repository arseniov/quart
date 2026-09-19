// src/components/issue/__tests__/OfflineDownloadButton.test.tsx
import '@/i18n';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

jest.mock('expo-file-system', () => {
  // ponytail: minimal FS mock — same in-memory registry as tile-cache.test.ts so the
  //          button reads back its own writes. Surface area kept tiny on purpose: only
  //          the methods OfflineDownloadButton touches.
  const state = { dirs: new Map<string, { uri: string; exists: boolean }>(), files: new Map<string, { content: string; size: number }>() };
  const document = { uri: 'file:///document' };
  const cache = { uri: 'file:///document/tiles' };
  function ensureDir(uri: string) {
    let d = state.dirs.get(uri);
    if (!d) { d = { uri, exists: true }; state.dirs.set(uri, d); }
    return d;
  }
  function ensureFile(uri: string) {
    let f = state.files.get(uri);
    if (!f) { f = { content: '', size: 0 }; state.files.set(uri, f); }
    return f;
  }
  class FakeFile {
    public uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
    get name() { return this.uri.split('/').pop() ?? ''; }
    create() { ensureFile(this.uri); }
    write(value: string) { const f = ensureFile(this.uri); f.content = value; f.size = value.length; }
    text() { return Promise.resolve(state.files.get(this.uri)?.content ?? ''); }
    get size() { return state.files.get(this.uri)?.size ?? 0; }
    delete() { state.files.delete(this.uri); }
  }
  class FakeDirectory {
    public uri: string;
    constructor(...mockUris: (string | FakeDirectory)[]) {
      if (mockUris.length === 0) { this.uri = ''; return; }
      const first = mockUris[0]!;
      const rest = mockUris.slice(1);
      const base = typeof first === 'string' ? first : first.uri;
      this.uri = rest.length === 0 ? base : `${base.replace(/\/$/, '')}/${rest.join('/')}`;
    }
    get name() { return this.uri.split('/').pop() ?? ''; }
    get exists() { return state.dirs.has(this.uri); }
    create() { ensureDir(this.uri); }
    delete() { state.dirs.delete(this.uri); state.files.delete(`${this.uri}/manifest.json`); }
    list() { return []; }
  }
  return {
    Paths: {
      get document() { return document; },
      get cache() { return cache; },
      get bundle() { return cache; },
      availableDiskSpace: 1_000_000_000,
    },
    Directory: FakeDirectory,
    File: FakeFile,
    __resetFileState: () => { state.dirs.clear(); state.files.clear(); },
  };
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

jest.mock('@maplibre/maplibre-react-native', () => ({
  // ponytail: keep surface area minimal — the button only calls createPack and never inspects the pack.
  OfflineManager: {
    createPack: jest.fn(() => Promise.resolve({ id: 'pack-1' })),
  },
}));

import NetInfo from '@react-native-community/netinfo';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import * as tileCache from '@/lib/tile-cache';
import { OfflineDownloadButton } from '../OfflineDownloadButton';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('expo-file-system') as { __resetFileState: () => void };
const mNI = NetInfo as jest.Mocked<typeof NetInfo>;
const mOffline = OfflineManager as jest.Mocked<typeof OfflineManager>;

beforeEach(() => {
  fsMock.__resetFileState();
  jest.clearAllMocks();
  mNI.fetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
});

describe('OfflineDownloadButton', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  it('renders the download CTA when nothing is cached', () => {
    const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="roma" />);
    expect(getByLabelText('Download map for offline')).toBeTruthy();
  });

  it('starts a download on tap and shows downloaded state', async () => {
    const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="milano" />);
    fireEvent.press(getByLabelText('Download map for offline'));

    await waitFor(() => {
      expect(mOffline.createPack).toHaveBeenCalledTimes(1);
      expect(getByLabelText('Available offline')).toBeTruthy();
    });
  });

  it('passes a flat [west, south, east, north] tuple, min/max zoom, and style to createPack', async () => {
    const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="bologna" />);
    fireEvent.press(getByLabelText('Download map for offline'));

    await waitFor(() => expect(mOffline.createPack).toHaveBeenCalled());
    const [options] = mOffline.createPack.mock.calls[0]!;
    expect(options.bounds).toEqual([12.4, 41.8, 12.6, 42.0]);
    expect(options.minZoom).toBe(10);
    expect(options.maxZoom).toBe(18);
    expect(typeof options.mapStyle).toBe('string');
  });

  it('shows noConnection label when offline', async () => {
    mNI.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);
    const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="torino" />);
    fireEvent.press(getByLabelText('Download map for offline'));
    await waitFor(() => {
      expect(getByLabelText('You appear to be offline.')).toBeTruthy();
      expect(mOffline.createPack).not.toHaveBeenCalled();
    });
  });

  it('shows meteredBlocked label when canDownloadOnCurrentNetwork rejects', async () => {
    // ponytail: spy on the gate so the button hits the metered branch deterministically.
    //          NetInfo is mocked as connected, so we route through canDownloadOnCurrentNetwork
    //          returning false — which is the Wi-Fi-only / cellular signal.
    const spy = jest.spyOn(tileCache, 'canDownloadOnCurrentNetwork').mockResolvedValue(false);
    try {
      const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="palermo" />);
      fireEvent.press(getByLabelText('Download map for offline'));
      await waitFor(() => {
        expect(getByLabelText('Disable Wi-Fi only in settings to download on cellular.')).toBeTruthy();
        expect(mOffline.createPack).not.toHaveBeenCalled();
      });
    } finally {
      spy.mockRestore();
    }
  });
});
