// src/observability/__tests__/sentry.test.ts
import type { Event } from '@sentry/react-native';

const mockInit = jest.fn();
const mockCaptureException = jest.fn();

// ponytail: jest@29 has no jest.hoisted — var is the smallest workable TDZ-free pattern.
// eslint-disable-next-line no-var
var mockExpoConfig: { version: string; extra: Record<string, unknown> } = {
  version: '0.0.1',
  extra: {},
};

jest.mock('@sentry/react-native', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() { return { expoConfig: mockExpoConfig }; },
}));

jest.mock('@/lib/env', () => ({
  get SENTRY_DSN() {
    return (mockExpoConfig.extra as { EXPO_PUBLIC_SENTRY_DSN?: string }).EXPO_PUBLIC_SENTRY_DSN;
  },
}));

import { initSentry, scrubPII } from '@/observability/sentry';

describe('scrubPII', () => {
  it('redacts top-level PII keys', () => {
    const out = scrubPII({ email: 'a@b.c', phone: '+39123', city: 'Rome' }) as Record<string, unknown>;
    expect(out.email).toBe('[REDACTED]');
    expect(out.phone).toBe('[REDACTED]');
    expect(out.city).toBe('Rome');
  });

  it('redacts nested PII in objects and arrays', () => {
    const out = scrubPII({
      user: { email: 'a@b.c', address: '1 St' },
      breadcrumbs: [{ data: { token: 't', label: 'safe' } }],
    }) as { user: Record<string, unknown>; breadcrumbs: Array<{ data: Record<string, unknown> }> };
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.user.address).toBe('[REDACTED]');
    const crumb = out.breadcrumbs[0]!;
    expect(crumb.data.token).toBe('[REDACTED]');
    expect(crumb.data.label).toBe('safe');
  });

  it('passes through primitives, null, and undefined', () => {
    expect(scrubPII(null)).toBeNull();
    expect(scrubPII(undefined)).toBeUndefined();
    expect(scrubPII(42)).toBe(42);
    expect(scrubPII('hi')).toBe('hi');
  });
});

describe('initSentry', () => {
  beforeEach(() => {
    mockInit.mockClear();
    mockCaptureException.mockClear();
    mockExpoConfig.extra = {};
    mockExpoConfig.version = '0.0.1';
  });

  it('does not call Sentry.init when DSN is empty', () => {
    mockExpoConfig.extra = { EXPO_PUBLIC_SENTRY_DSN: '' };
    initSentry();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('calls Sentry.init with the configured DSN and release', () => {
    mockExpoConfig.extra = { EXPO_PUBLIC_SENTRY_DSN: 'https://key@sentry.io/1' };
    mockExpoConfig.version = '1.2.3';
    initSentry();
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0].dsn).toBe('https://key@sentry.io/1');
    expect(mockInit.mock.calls[0][0].release).toBe('1.2.3');
  });

  it('passes release as undefined when expoConfig.version is undefined', () => {
    mockExpoConfig.extra = { EXPO_PUBLIC_SENTRY_DSN: 'https://key@sentry.io/1' };
    mockExpoConfig.version = undefined as unknown as string;
    initSentry();
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0].release).toBeUndefined();
  });

  describe('beforeSend', () => {
    let beforeSend: (event: Event) => Event | null;

    beforeEach(() => {
      mockExpoConfig.extra = { EXPO_PUBLIC_SENTRY_DSN: 'https://key@sentry.io/1' };
      initSentry();
      beforeSend = mockInit.mock.calls[0][0].beforeSend as (event: Event) => Event | null;
    });

    it('strips user fields except id', () => {
      const out = beforeSend({
        user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
      } as unknown as Event);
      expect(out?.user).toEqual({ id: 'u1' });
    });

    it('sets user to {} when id is undefined', () => {
      const out = beforeSend({
        user: { email: 'a@b.c' },
      } as unknown as Event);
      expect(out?.user).toEqual({});
    });

    it('drops request cookies and data', () => {
      const out = beforeSend({
        request: { cookies: 'sid=abc', data: { password: 'x' } },
      } as unknown as Event);
      const req = out?.request as { cookies?: unknown; data?: unknown };
      expect(req.cookies).toBeUndefined();
      expect(req.data).toBeUndefined();
    });

    it('treats missing breadcrumbs as empty', () => {
      const out = beforeSend({} as unknown as Event);
      expect(out?.breadcrumbs).toEqual([]);
    });

    it('scrubs PII from breadcrumb data', () => {
      const out = beforeSend({
        breadcrumbs: [
          { data: { email: 'a@b.c', label: 'safe' } },
          { message: 'no data here' },
        ],
      } as unknown as Event);
      const bcs = out?.breadcrumbs ?? [];
      const first = bcs[0]!;
      const firstData = first.data as Record<string, unknown>;
      expect(firstData.email).toBe('[REDACTED]');
      expect(firstData.label).toBe('safe');
      expect(bcs[1]?.data).toBeUndefined();
    });
  });
});