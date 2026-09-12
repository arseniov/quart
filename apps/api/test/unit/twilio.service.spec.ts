import { describe, it, expect, vi } from 'vitest';

import { TwilioService } from '../../src/auth/twilio.service.js';

function makeService(cfg: { accountSid: string; authToken: string; verifyServiceSid: string }) {
  const tw = new TwilioService();
  // ponytail: env-driven config in prod; tests inject directly.
  (tw as unknown as { cfg: typeof cfg }).cfg = cfg;
  return tw;
}

describe('TwilioService', () => {
  it('sends an OTP via Twilio Verify /Verifications', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ sid: 'V123' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const tw = makeService({ accountSid: 'AC', authToken: 'tok', verifyServiceSid: 'VS' });
    tw.fetcher = fetchMock;

    const r = await tw.sendOtp('+391111111111');

    expect(r.sid).toBe('V123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://verify.twilio.com/v2/Services/VS/Verifications');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('To=%2B391111111111&Channel=sms');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC:tok').toString('base64')}`,
    );
  });

  it('verifyOtp returns true on status approved', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: 'approved' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const tw = makeService({ accountSid: 'AC', authToken: 'tok', verifyServiceSid: 'VS' });
    tw.fetcher = fetchMock;

    expect(await tw.verifyOtp('+391111111111', '123456')).toBe(true);
    const [url] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://verify.twilio.com/v2/Services/VS/VerificationCheck');
  });

  it('verifyOtp returns false on status pending', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ status: 'pending' }), { status: 200 }),
    ) as unknown as typeof fetch;
    const tw = makeService({ accountSid: 'AC', authToken: 'tok', verifyServiceSid: 'VS' });
    tw.fetcher = fetchMock;

    expect(await tw.verifyOtp('+391111111111', '000000')).toBe(false);
  });
});