// app/(app)/settings/__tests__/index.test.tsx
// GH #22 — verifies the Offline maps badge in settings → storage.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
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

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  // ponytail: don't run the focus callback during render — the component seeds stats from
  //          its initial useState, which already calls getStorageStats() with seeded data.
  useFocusEffect: () => undefined,
}));

jest.mock('@/api/hooks/useMe', () => ({
  useMe: jest.fn(() => ({
    data: { id: 'u1', handle: 'u1' },
    isPending: false,
  })),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: jest.fn() }),
}));

jest.mock('@/lib/auth', () => ({
  clearTokens: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fsMock = require('expo-file-system') as { __seed: (id: string, bytes: number) => void; __resetFileState: () => void };
import SettingsIndex from '../index';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('it');
});

beforeEach(() => {
  fsMock.__resetFileState();
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