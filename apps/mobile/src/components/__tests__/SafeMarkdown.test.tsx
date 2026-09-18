// src/components/__tests__/SafeMarkdown.test.tsx
// jest-expo already defines globalThis.structuredClone as a getter. mdast-util-to-hast
// (transitive via remark-rehype) imports @ungap/structured-clone which re-installs
// the polyfill on top of that getter, blowing up at import time. Stub @ungap so
// the unified chain loads without re-polyfilling. ponytail: Security guarantee
// is the sanitize pipeline; react-native-markdown-display rendering is exercised
// in app build, not here.
jest.mock('@ungap/structured-clone', () => ({
  __esModule: true,
  default: (value: unknown) => JSON.parse(JSON.stringify(value)),
  deserialize: (value: unknown) => value,
  serialize: (value: unknown) => value,
}));

import { sanitize } from '../Markdown';

describe('sanitize (markdown pipeline)', () => {
  it('keeps allowed inline text', () => {
    expect(sanitize('hello **bold**')).toContain('hello');
  });

  it('preserves fenced code blocks without leaking className', () => {
    const out = sanitize('```js\nconst x = 1;\n```');
    expect(out).toContain('const x = 1;');
    expect(out).not.toContain('language-');
  });

  it('strips javascript: URLs', () => {
    const out = sanitize('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert(1)');
  });

  it('strips data: URLs', () => {
    const out = sanitize('[click](data:text/html,<script>alert(1)</script>)');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('text/html');
    expect(out).not.toContain('script');
  });

  it('strips images (including onerror-style titles)', () => {
    const out = sanitize('![alt](https://example.com/x.png "onerror=alert(1)")');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('keeps https links intact', () => {
    const out = sanitize('[ok](https://quart.app)');
    expect(out).toContain('ok');
    expect(out).toContain('https://quart.app');
  });

  it('drops img and javascript: payloads, keeps https links (mixed payload)', () => {
    const out = sanitize(
      '![x](https://x/y.png "onerror=alert(1)")[click](javascript:alert(1))[ok](https://quart.app)',
    );
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('https://quart.app');
  });
});
