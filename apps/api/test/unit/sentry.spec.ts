import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  nodeProfilingIntegration: vi.fn(() => ({ name: 'ProfilingIntegration' })),
}));

vi.mock('@sentry/node', () => ({ init: mocks.init }));
vi.mock('@sentry/profiling-node', () => ({ nodeProfilingIntegration: mocks.nodeProfilingIntegration }));

// Import after vi.mock so the module picks up the mocked Sentry.
import { beforeSendForSentry, initSentry } from '../../src/observability/sentry.js';

const REDACTED = '[redacted]';

describe('initSentry', () => {
  beforeEach(() => {
    mocks.init.mockReset();
  });

  it('is a no-op when SENTRY_DSN is empty', () => {
    initSentry({ SENTRY_DSN: '', SENTRY_ENVIRONMENT: 'development' } as never);
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init with DSN, environment, sample rate, and beforeSend', () => {
    initSentry({ SENTRY_DSN: 'https://k@s.io/1', SENTRY_ENVIRONMENT: 'production' } as never);
    expect(mocks.init).toHaveBeenCalledOnce();
    const opts = mocks.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.dsn).toBe('https://k@s.io/1');
    expect(opts.environment).toBe('production');
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.beforeSend).toBe(beforeSendForSentry);
  });
});

describe('beforeSendForSentry', () => {
  it('strips cookies, request.data, query_string, and PII from URL', () => {
    const evt = {
      request: {
        cookies: 'sid=abc',
        data: { password: 'p' },
        url: 'https://api.example.com/x?email=a@b.com',
        query_string: 'foo=bar&email=x@y.io',
        headers: { authorization: 'Bearer t', cookie: 'sid=1', 'set-cookie': 'sid=1', 'x-trace': 'abc' },
      },
      user: { id: 'u', email: 'a@b.com', ip_address: '1.2.3.4' },
      breadcrumbs: [{ data: { phone: '+391', password: 'p' } }],
      extra: { password: 'p', nested: { refresh_token: 'rt', safe: 'ok' } },
      contexts: { app: { build: '1' } },
    } as never;
    const out = beforeSendForSentry(evt) as never as {
      request: { cookies?: unknown; data?: unknown; url: string; query_string: string; headers: Record<string, string> };
      user: Record<string, unknown>;
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
      extra: Record<string, unknown>;
      contexts: Record<string, unknown>;
    };

    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBeUndefined();
    expect(out.request.url).not.toContain('a@b.com');
    expect(out.request.url).toContain('[redacted-email]');
    expect(out.request.query_string).not.toContain('x@y.io');
    expect(out.request.headers.authorization).toBe(REDACTED);
    expect(out.request.headers.cookie).toBe(REDACTED);
    expect(out.request.headers['set-cookie']).toBe(REDACTED);
    expect(out.request.headers['x-trace']).toBe('abc');
    expect(out.user.email).toBeUndefined();
    expect(out.user.ip_address).toBeUndefined();
    expect(out.user.id).toBe('u');
    expect(out.breadcrumbs[0]?.data.password).toBe(REDACTED);
    expect(out.breadcrumbs[0]?.data.phone).toBe(REDACTED);
    expect(out.extra.password).toBe(REDACTED);
    expect((out.extra.nested as Record<string, unknown>).refresh_token).toBe(REDACTED);
    expect((out.extra.nested as Record<string, unknown>).safe).toBe('ok');
    expect(out.contexts.app).toBeDefined();
  });

  it('scrubs emails and IPs from request URL and query_string', () => {
    const evt = {
      request: {
        url: 'https://api.example.com/u/1.2.3.4/profile/a@b.com',
        query_string: 'gclid=abc&email=x@y.io&ip=9.9.9.9',
      },
    } as never;
    const out = beforeSendForSentry(evt) as never as { request: { url: string; query_string: string } };
    expect(out.request.url).not.toMatch(/a@b\.com/);
    expect(out.request.url).not.toMatch(/1\.2\.3\.4/);
    expect(out.request.url).toContain('[redacted-email]');
    expect(out.request.url).toContain('[redacted-ip]');
    expect(out.request.query_string).not.toMatch(/x@y\.io/);
    expect(out.request.query_string).not.toMatch(/9\.9\.9\.9/);
  });

  it('redacts PII keys recursively in breadcrumbs.data (deeply nested)', () => {
    const evt = {
      breadcrumbs: [
        {
          data: {
            password: 'p',
            nested: { token: 't', deeper: { api_key: 'k', safe: 's' } },
            arr: [{ jwt: 'j', ok: 1 }],
          },
        },
      ],
    } as never;
    const out = beforeSendForSentry(evt) as never as {
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
    };
    const d = out.breadcrumbs[0]!.data;
    expect(d.password).toBe(REDACTED);
    expect((d.nested as Record<string, unknown>).token).toBe(REDACTED);
    expect(
      ((d.nested as Record<string, unknown>).deeper as Record<string, unknown>).api_key,
    ).toBe(REDACTED);
    expect(
      ((d.nested as Record<string, unknown>).deeper as Record<string, unknown>).safe,
    ).toBe('s');
    expect(((d.arr as Array<Record<string, unknown>>)[0]!).jwt).toBe(REDACTED);
    expect(((d.arr as Array<Record<string, unknown>>)[0]!).ok).toBe(1);
  });

  it('redacts case-insensitive PII keys', () => {
    const evt = { extra: { PASSWORD: 'p', Email: 'a@b', apiKey: 'k' } } as never;
    const out = beforeSendForSentry(evt) as never as { extra: Record<string, unknown> };
    expect(out.extra.PASSWORD).toBe(REDACTED);
    expect(out.extra.Email).toBe(REDACTED);
    expect(out.extra.apiKey).toBe(REDACTED);
  });

  it('redacts Italian codice fiscale and partita IVA in breadcrumb data', () => {
    const evt = {
      breadcrumbs: [{ data: { fiscal_code: 'RSSMRA85T10A562S', note: 'lookup' } }],
      extra: { vat: '12345678901' },
    } as never;
    const out = beforeSendForSentry(evt) as never as {
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
      extra: Record<string, unknown>;
    };
    expect(out.breadcrumbs[0]?.data.fiscal_code).toBe(REDACTED);
    expect(out.breadcrumbs[0]?.data.note).toBe('lookup');
    expect(out.extra.vat).toBe(REDACTED);
  });

  it('redacts embedded codice fiscale and VAT inside free-text values', () => {
    const evt = {
      breadcrumbs: [{ data: { message: 'user RSSMRA85T10A562S signed up with VAT 12345678901' } }],
    } as never;
    const out = beforeSendForSentry(evt) as never as {
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
    };
    const msg = out.breadcrumbs[0]?.data.message as string;
    expect(msg).not.toContain('RSSMRA85T10A562S');
    expect(msg).not.toContain('12345678901');
    expect(msg).toContain('user');
    expect(msg).toContain('signed up');
  });

  it('keeps non-PII metadata (event_id, timestamp, sdk)', () => {
    const evt = {
      event_id: 'abc',
      timestamp: 1700000000,
      sdk: { name: 'sentry-node', version: '8' },
    } as never;
    const out = beforeSendForSentry(evt) as never as { event_id: string; timestamp: number; sdk: { name: string } };
    expect(out.event_id).toBe('abc');
    expect(out.timestamp).toBe(1700000000);
    expect(out.sdk.name).toBe('sentry-node');
  });
});