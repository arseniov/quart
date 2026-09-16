import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  nodeProfilingIntegration: vi.fn(() => ({ name: 'ProfilingIntegration' })),
}));

vi.mock('@sentry/node', () => ({ init: mocks.init }));
vi.mock('@sentry/profiling-node', () => ({ nodeProfilingIntegration: mocks.nodeProfilingIntegration }));

// Import after vi.mock so the module picks up the mocked Sentry.
import {
  beforeSendForSentry,
  CYCLE_MARKER,
  DEPTH_CAPPED_MARKER,
  initSentry,
  REDACTED,
  REDACTED_EMAIL,
  REDACTED_IP,
  REDACTED_PHONE,
} from '../../src/observability/sentry.js';

describe('initSentry', () => {
  beforeEach(() => {
    mocks.init.mockReset();
  });

  it('is a no-op when SENTRY_DSN is empty', () => {
    initSentry({ SENTRY_DSN: '', SENTRY_ENVIRONMENT: 'development' });
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('calls Sentry.init with DSN, environment, traces sample rate, and beforeSend', () => {
    initSentry({ SENTRY_DSN: 'https://k@s.io/1', SENTRY_ENVIRONMENT: 'production' });
    expect(mocks.init).toHaveBeenCalledOnce();
    const opts = mocks.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.dsn).toBe('https://k@s.io/1');
    expect(opts.environment).toBe('production');
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.beforeSend).toBe(beforeSendForSentry);
  });

  it('does not enable profiling by default', () => {
    initSentry({ SENTRY_DSN: 'd', SENTRY_ENVIRONMENT: 'development' });
    const opts = mocks.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.profilesSampleRate).toBeUndefined();
    expect(opts.integrations).toBeUndefined();
  });

  it('enables profiling when SENTRY_PROFILING=true', () => {
    initSentry({
      SENTRY_DSN: 'd',
      SENTRY_ENVIRONMENT: 'development',
      SENTRY_PROFILING: 'true',
    });
    const opts = mocks.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.profilesSampleRate).toBe(0.1);
    expect(mocks.nodeProfilingIntegration).toHaveBeenCalledOnce();
    const integrations = opts.integrations as unknown[];
    expect(Array.isArray(integrations)).toBe(true);
    expect(integrations.length).toBe(1);
  });

  it('does not enable profiling when SENTRY_PROFILING is some other truthy string', () => {
    initSentry({
      SENTRY_DSN: 'd',
      SENTRY_ENVIRONMENT: 'development',
      SENTRY_PROFILING: '1',
    });
    const opts = mocks.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.profilesSampleRate).toBeUndefined();
    expect(opts.integrations).toBeUndefined();
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
    const out = beforeSendForSentry(evt, {} as never) as never as {
      request: { cookies?: unknown; data?: unknown; url: string; query_string: string; headers: Record<string, string> };
      user: Record<string, unknown>;
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
      extra: Record<string, unknown>;
      contexts: Record<string, unknown>;
    };

    expect(out.request.cookies).toBeUndefined();
    expect(out.request.data).toBeUndefined();
    expect(out.request.url).not.toContain('a@b.com');
    expect(out.request.url).toContain(REDACTED_EMAIL);
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
    const out = beforeSendForSentry(evt, {} as never) as never as { request: { url: string; query_string: string } };
    expect(out.request.url).not.toMatch(/a@b\.com/);
    expect(out.request.url).not.toMatch(/1\.2\.3\.4/);
    expect(out.request.url).toContain(REDACTED_EMAIL);
    expect(out.request.url).toContain(REDACTED_IP);
    expect(out.request.query_string).not.toMatch(/x@y\.io/);
    expect(out.request.query_string).not.toMatch(/9\.9\.9\.9/);
  });

  it('recurses into non-string request.query_string objects', () => {
    const evt = {
      request: {
        query_string: { email: 'a@b.com', safe: 'ok' },
      },
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as {
      request: { query_string: Record<string, unknown> };
    };
    expect(out.request.query_string.email).toBe(REDACTED);
    expect(out.request.query_string.safe).toBe('ok');
  });

  it('scrubs embedded PII in event.message', () => {
    const evt = { message: 'Failed for user a@b.com at 1.2.3.4' } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { message: string };
    expect(out.message).not.toContain('a@b.com');
    expect(out.message).not.toContain('1.2.3.4');
    expect(out.message).toContain(REDACTED_EMAIL);
    expect(out.message).toContain(REDACTED_IP);
    expect(out.message).toContain('Failed for user');
  });

  it('scrubs exception.values[*].value and stacktrace frames vars', () => {
    const evt = {
      exception: {
        values: [
          {
            value: 'invalid email a@b.com with VAT 12345678901',
            stacktrace: { frames: [{ vars: { password: 'p', email: 'a@b.com' } }] },
          },
        ],
      },
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as {
      exception: {
        values: Array<{
          value: string;
          stacktrace: { frames: Array<{ vars: Record<string, unknown> }> };
        }>;
      };
    };
    const v = out.exception.values[0]!;
    expect(v.value).not.toContain('a@b.com');
    expect(v.value).not.toContain('12345678901');
    expect(v.value).toContain(REDACTED_EMAIL);
    expect(v.value).toContain(REDACTED);
    expect(v.stacktrace.frames[0]?.vars.password).toBe(REDACTED);
    expect(v.stacktrace.frames[0]?.vars.email).toBe(REDACTED);
  });

  it('scrubs event.transaction', () => {
    const evt = { transaction: 'GET /users/a@b.com from 1.2.3.4' } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { transaction: string };
    expect(out.transaction).not.toContain('a@b.com');
    expect(out.transaction).not.toContain('1.2.3.4');
    expect(out.transaction).toContain(REDACTED_EMAIL);
    expect(out.transaction).toContain(REDACTED_IP);
  });

  it('scrubs event.tags values', () => {
    const evt = {
      tags: { user_email: 'a@b.com', client_ip: '1.2.3.4', build: '1.2.3' },
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { tags: Record<string, string> };
    expect(out.tags.user_email).toContain(REDACTED_EMAIL);
    expect(out.tags.client_ip).toContain(REDACTED_IP);
    expect(out.tags.build).toBe('1.2.3');
  });

  it('scrubs breadcrumb message text', () => {
    const evt = {
      breadcrumbs: [{ message: 'lookup a@b.com at 1.2.3.4' }],
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as {
      breadcrumbs: Array<{ message: string }>;
    };
    expect(out.breadcrumbs[0]?.message).not.toContain('a@b.com');
    expect(out.breadcrumbs[0]?.message).toContain(REDACTED_EMAIL);
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
    const out = beforeSendForSentry(evt, {} as never) as never as {
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
    const out = beforeSendForSentry(evt, {} as never) as never as { extra: Record<string, unknown> };
    expect(out.extra.PASSWORD).toBe(REDACTED);
    expect(out.extra.Email).toBe(REDACTED);
    expect(out.extra.apiKey).toBe(REDACTED);
  });

  it('redacts Italian codice fiscale and partita IVA in breadcrumb data', () => {
    const evt = {
      breadcrumbs: [{ data: { fiscal_code: 'RSSMRA85T10A562S', note: 'lookup' } }],
      extra: { vat: '12345678901' },
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as {
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
    const out = beforeSendForSentry(evt, {} as never) as never as {
      breadcrumbs: Array<{ data: Record<string, unknown> }>;
    };
    const msg = out.breadcrumbs[0]?.data.message as string;
    expect(msg).not.toContain('RSSMRA85T10A562S');
    expect(msg).not.toContain('12345678901');
    expect(msg).toContain('user');
    expect(msg).toContain('signed up');
  });

  it.each([
    ['Italian +39 spaced', 'call +39 333 1234567 please'],
    ['Italian +39 no spaces', 'call +393331234567 please'],
    ['E.164 US spaced', 'call +1 555 123 4567 please'],
    ['Italian 3-prefix mobile no country code', 'call 333 123 4567 please'],
  ])('redacts free-text phone: %s', (_label, message) => {
    const evt = { message } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { message: string };
    // None of the digits in the original phone shape survive.
    const digits = message.replace(/[^\d+]/g, '');
    expect(out.message).toContain(REDACTED_PHONE);
    expect(out.message).not.toMatch(/\+?\d/);
    expect(out.message).not.toBe(message);
    expect(digits.replace('+', '').length).toBeGreaterThan(0);
  });

  it.each([
    ['Italian landline', 'call 02 1234 5678'],
    ['time stamp', 'My flight is at 333pm'],
    ['random number', 'Lorem ipsum 12345'],
  ])('does NOT over-redact benign strings: %s', (_label, message) => {
    const evt = { message } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { message: string };
    expect(out.message).not.toContain(REDACTED_PHONE);
  });

  it('keeps non-PII metadata (event_id, timestamp, sdk)', () => {
    const evt = {
      event_id: 'abc',
      timestamp: 1700000000,
      sdk: { name: 'sentry-node', version: '8' },
    } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as { event_id: string; timestamp: number; sdk: { name: string } };
    expect(out.event_id).toBe('abc');
    expect(out.timestamp).toBe(1700000000);
    expect(out.sdk.name).toBe('sentry-node');
  });

  it('does not mutate the input event', () => {
    const evt = {
      message: 'a@b.com',
      extra: { password: 'p' },
      breadcrumbs: [{ message: 'lookup a@b.com', data: { token: 't' } }],
    } as never;
    const snapshot = JSON.parse(JSON.stringify(evt));
    beforeSendForSentry(evt, {} as never);
    expect(evt).toEqual(snapshot);
  });

  it('handles circular references without stack overflow and returns [cycle] for the marker', () => {
    const a: Record<string, unknown> = {};
    a.b = a;
    const evt = { extra: a } as never;
    const out = beforeSendForSentry(evt, {} as never) as never as
      | { extra: Record<string, unknown> }
      | null;
    expect(out).not.toBeNull();
    expect(out?.extra.b).toBe(CYCLE_MARKER);
  });

  it('caps recursion at depth 8 with [depth-capped]', () => {
    // Build 10 nested objects programmatically to avoid esbuild's parser
    // getting confused by a deeply-nested object literal at the top of an
    // arrow body (treats the leading `{` as a block statement).
    let deep: Record<string, unknown> = { j: 'leaf' };
    for (const k of ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']) {
      deep = { [k]: deep };
    }
    const out = beforeSendForSentry({ extra: deep } as never, {} as never) as never as {
      extra: Record<string, unknown>;
    };
    let cur: unknown = out.extra;
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      // eslint-disable-next-line security/detect-object-injection -- test walks a fixed key list built above
      cur = (cur as Record<string, unknown>)[k];
    }
    expect(cur).toEqual({ h: DEPTH_CAPPED_MARKER });
  });

  it('returns null when scrubbing throws (fail-closed)', () => {
    // Force the scrubber to throw by passing a non-iterable-but-object value
    // into scrub via the extra path. A Proxy with a throwing iterator does it.
    const evil: Record<string, unknown> = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('boom');
        },
      },
    );
    const out = beforeSendForSentry({ extra: evil } as never, {} as never);
    expect(out).toBeNull();
  });
});
