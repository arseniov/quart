import { Injectable } from '@nestjs/common';

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  verifyServiceSid: string;
}

export interface TwilioSendResult {
  sid: string;
}

/**
 * Twilio Verify SMS API. Generates + delivers OTPs server-side; we just
 * proxy the start/check endpoints from Better Auth's phoneNumber plugin.
 *
 * Env vars are read from process.env directly (not ConfigService) so the
 * service has zero coupling to the env schema; if they're missing the
 * service still constructs but calls will fail at the HTTP layer with a
 * 401 from Twilio.
 */
@Injectable()
export class TwilioService {
  // ponytail: injectable fetcher is a public property so tests can swap it
  // without going through Nest DI; production wiring uses global `fetch`.
  fetcher: typeof fetch = fetch;
  private readonly cfg: TwilioConfig;

  constructor() {
    this.cfg = {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID ?? '',
    };
  }

  async sendOtp(phoneE164: string): Promise<TwilioSendResult> {
    const r = await this.fetcher(
      this.url('start'),
      this.basic('POST', { To: phoneE164, Channel: 'sms' }),
    );
    return (await r.json()) as TwilioSendResult;
  }

  async verifyOtp(phoneE164: string, code: string): Promise<boolean> {
    const r = await this.fetcher(
      this.url('check'),
      this.basic('POST', { To: phoneE164, Code: code }),
    );
    const j = (await r.json()) as { status: string };
    return j.status === 'approved';
  }

  private url(action: 'start' | 'check'): string {
    const base = `https://verify.twilio.com/v2/Services/${this.cfg.verifyServiceSid}`;
    return action === 'start' ? `${base}/Verifications` : `${base}/VerificationCheck`;
  }

  private basic(method: 'POST', body: Record<string, string>): RequestInit {
    return {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    };
  }
}