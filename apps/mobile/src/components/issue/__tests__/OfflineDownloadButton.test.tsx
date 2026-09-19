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

import NetInfo from '@react-native-community/netinfo';
import { OfflineDownloadButton } from '../OfflineDownloadButton';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('expo-file-system') as { __resetFileState: () => void };
const mNI = NetInfo as jest.Mocked<typeof NetInfo>;

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
      expect(getByLabelText('Available offline')).toBeTruthy();
    });
  });

  it('removes the bundle on a second tap (toggle)', async () => {
    const { getByLabelText, queryByLabelText } = render(<OfflineDownloadButton cityAreaId="napoli" />);
    fireEvent.press(getByLabelText('Download map for offline'));
    await waitFor(() => getByLabelText('Available offline'));
    fireEvent.press(getByLabelText('Available offline'));
    await waitFor(() => {
      expect(queryByLabelText('Available offline')).toBeNull();
      expect(getByLabelText('Download map for offline')).toBeTruthy();
    });
  });

  it('shows a metered-blocked message when offline', async () => {
    mNI.fetch.mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);
    const { getByLabelText } = render(<OfflineDownloadButton cityAreaId="torino" />);
    fireEvent.press(getByLabelText('Download map for offline'));
    await waitFor(() => {
      expect(getByLabelText('Disable Wi-Fi only in settings to download on cellular.')).toBeTruthy();
    });
  });
});