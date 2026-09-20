// app/(app)/settings/__tests__/index.test.tsx
// GH #22 — verifies the Offline maps badge in settings → storage.
// GH #32 — verifies logout POSTs /auth/sign-out and survives a server failure.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import i18n from '@/i18n';

jest.mock('expo-file-system', () => {
  const state = {
    dirs: new Map<string, { uri: string }>(),
    files: new Map<string, { content: string; size: number }>(),
    availableDiskSpace: 1_000_000_000,
  };
  function ensureDir(uri: string) {
    let d = state.dirs.get(uri);
    if (!d) { d = { uri }; state.dirs.set(uri, d); }
    return d;
  }
  function ensureFile(uri: string) {
    let f = state.files.get(uri);
    if (!f) { f = { content: '', size: 0 }; state.files.set(uri, f); }
    return f;
  }
  class FakeFile {
    public uri: string;
    constructor(...mockUris: (string | FakeDirectory)[]) {
      if (mockUris.length === 0) { this.uri = ''; return; }
      const first = mockUris[0]!;
      const rest = mockUris.slice(1);
      const base = typeof first === 'string' ? first : first.uri;
      this.uri = rest.length === 0 ? base : `${base.replace(/\/$/, '')}/${rest.join('/')}`;
    }
    get name() { return this.uri.split('/').pop() ?? ''; }
    create() { ensureFile(this.uri); }
    write(value: string) { const f = ensureFile(this.uri); f.content = value; f.size = value.length; }
    // ponytail: real expo-file-system returns Promise<string>; the production readJsonFile awaits.
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
    list() {
      const out: (FakeFile | FakeDirectory)[] = [];
      // ponytail: surface immediate children of `this.uri` from the registry.
      const prefix = `${this.uri.replace(/\/$/, '')}/`;
      for (const [fileUri] of state.files) {
        if (fileUri.startsWith(prefix) && !fileUri.slice(prefix.length).includes('/')) {
          out.push(new FakeFile(fileUri));
        }
      }
      for (const [dirUri] of state.dirs) {
        if (dirUri !== this.uri && dirUri.startsWith(prefix) && !dirUri.slice(prefix.length).includes('/')) {
          out.push(new FakeDirectory(dirUri));
        }
      }
      return out;
    }
  }
  // ponytail: cacheDir + documentDir singletons are registered eagerly so production code's
  //          `new Directory(Paths.document, 'tiles')` returns a Directory backed by the same
  //          uri that's already in `state.dirs`. Without this, listBundles would find zero
  //          children because list() filters by uri match in `state.dirs`.
  const documentDir = new FakeDirectory('file:///document');
  const cacheDir = new FakeDirectory('file:///document/tiles');
  ensureDir(documentDir.uri);
  ensureDir(cacheDir.uri);

  return {
    Paths: {
      get document() { return documentDir; },
      get cache() { return new FakeDirectory('file:///cache'); },
      get bundle() { return new FakeDirectory('file:///bundle'); },
      get availableDiskSpace() { return state.availableDiskSpace; },
      set availableDiskSpace(v: number) { state.availableDiskSpace = v; },
    },
    Directory: FakeDirectory,
    File: FakeFile,
    __seed: (cityAreaId: string, sizeBytes: number) => {
      const dir = new FakeDirectory('file:///document/tiles', cityAreaId);
      dir.create();
      const mf = new FakeFile(dir, 'manifest.json');
      mf.create();
      mf.write(JSON.stringify({ cityAreaId, downloadedAt: new Date().toISOString(), sizeBytes }));
    },
    __resetFileState: () => { state.dirs.clear(); state.files.clear(); ensureDir(documentDir.uri); ensureDir(cacheDir.uri); },
  };
});

jest.mock('expo-router', () => {
  // ponytail: shared router singleton so logout tests can assert router.replace was called;
  //          a factory-per-call mock would hide the captured router instance per render.
  const router = { push: jest.fn(), replace: jest.fn() };
  return {
    __esModule: true,
    Stack: { Screen: () => null },
    useRouter: () => router,
    useFocusEffect: () => undefined,
    __router: router,
  };
});

jest.mock('@/api/hooks/useMe', () => ({
  useMe: jest.fn(() => ({
    data: { id: 'u1', handle: 'u1' },
    isPending: false,
  })),
}));

jest.mock('@/api/client', () => {
  const post = jest.fn(() => Promise.resolve({ status: 204, data: undefined, headers: new Headers() }));
  return { apiClient: { post }, __postMock: post };
});

jest.mock('@tanstack/react-query', () => {
  const qc = { clear: jest.fn() };
  return { useQueryClient: () => qc, __qc: qc };
});

jest.mock('@/lib/auth', () => ({
  clearTokens: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('expo-file-system') as { __seed: (id: string, bytes: number) => void; __resetFileState: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const apiMock = require('@/api/client') as { apiClient: { post: jest.Mock }; __postMock: jest.Mock };
import SettingsIndex from '../index';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('it');
});

beforeEach(() => {
  fsMock.__resetFileState();
  apiMock.__postMock.mockClear();
  apiMock.__postMock.mockResolvedValue({ status: 204, data: undefined, headers: new Headers() });
});

describe('SettingsIndex — offline maps badge', () => {

  it('renders the empty-state CTA when no bundle is cached', async () => {
    const { findByText } = render(<SettingsIndex />);
    await waitFor(async () => {
      expect(await findByText('Download map for offline')).toBeTruthy();
    });
  });

  it('renders "Downloaded · 24 MB" when a 24MB bundle is cached', async () => {
    fsMock.__seed('roma', 24_000_000);
    const { findByText } = render(<SettingsIndex />);
    await waitFor(async () => {
      expect(await findByText('Downloaded · 24 MB')).toBeTruthy();
    });
  });

  it('aggregates totalBytes across multiple bundles', async () => {
    fsMock.__seed('a', 10_000_000);
    fsMock.__seed('b', 14_000_000);
    const { findByText } = render(<SettingsIndex />);
    await waitFor(async () => {
      expect(await findByText('Downloaded · 24 MB')).toBeTruthy();
    });
  });
});

// GH #32 — logout must POST /auth/sign-out (audit chain §3.8) AND survive a server failure.
describe('SettingsIndex — logout', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const authMock = require('@/lib/auth') as { clearTokens: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const routerNs = require('expo-router') as { __router: { replace: jest.Mock; push: jest.Mock } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const qcNs = require('@tanstack/react-query') as { __qc: { clear: jest.Mock } };

  beforeEach(() => {
    authMock.clearTokens.mockClear();
    authMock.clearTokens.mockResolvedValue(undefined);
    routerNs.__router.replace.mockClear();
    qcNs.__qc.clear.mockClear();
  });

  it('POSTs /auth/sign-out with Authorization header, clears tokens, and redirects to /login', async () => {
    const { findByLabelText } = render(<SettingsIndex />);
    const logout = await findByLabelText('Log out');
    fireEvent.press(logout);
    // GH #32 — skipAuth:true would strip the Bearer header so JwtAuthGuard 401s before
    //          SignOutService writes the auth.sign_out audit row (§3.8). Confirm Authorization
    //          is attached by asserting skipAuth was NOT set on the call.
    await waitFor(() => {
      expect(apiMock.__postMock).toHaveBeenCalledWith('/auth/sign-out', null);
      expect(apiMock.__postMock).not.toHaveBeenCalledWith(
        '/auth/sign-out',
        null,
        expect.objectContaining({ skipAuth: true }),
      );
    });
    expect(authMock.clearTokens).toHaveBeenCalledTimes(1);
    expect(qcNs.__qc.clear).toHaveBeenCalledTimes(1);
    expect(routerNs.__router.replace).toHaveBeenCalledWith('/login');
  });

  it('still clears tokens and redirects when /auth/sign-out throws', async () => {
    apiMock.__postMock.mockRejectedValueOnce(new Error('network down'));
    const { findByLabelText } = render(<SettingsIndex />);
    const logout = await findByLabelText('Log out');
    fireEvent.press(logout);
    await waitFor(() => {
      expect(authMock.clearTokens).toHaveBeenCalledTimes(1);
    });
    expect(qcNs.__qc.clear).toHaveBeenCalledTimes(1);
    expect(routerNs.__router.replace).toHaveBeenCalledWith('/login');
  });
});