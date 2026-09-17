import { Injectable, Logger } from '@nestjs/common';

import type { ConfigService } from '../config/config.service.js';

export interface EmailPayload {
  /** Recipient address. Captured at fan-out time so retries are stable. */
  to: string;
  subject: string;
  /** Plain-text body. */
  body: string;
  /** Notification id; written back to `notification_deliveries` on success. */
  notificationId: string;
  /** `notification_deliveries.id` — primary key, used for status updates. */
  deliveryId: string;
}

/** Function the email worker calls to deliver a single message. Tests inject a
 *  fake; production wires the real SES v2 `SendEmailCommand`. The signature
 *  intentionally matches a tiny subset of `@aws-sdk/client-sesv2` so dropping
 *  the SDK in is a one-line change inside the default `sesSend`. */
export type SesSend = (p: EmailPayload) => Promise<void>;

/** Default SES sender — no-op until `@aws-sdk/client-sesv2` is added. Logs each
 *  send so dev / test envs see that the worker is draining. Production must
 *  set SES_FROM_ADDRESS and replace this with a real SendEmailCommand call. */
async function defaultSesSend(p: EmailPayload): Promise<void> {
  // ponytail: stdout-only fallback. Add @aws-sdk/client-sesv2 + a real SES
  // client when SES_FROM_ADDRESS is configured.
  console.log('[email] (stub) sending', { to: p.to, subject: p.subject });
}

/** Email delivery service. Stateless — every input carries the recipient and
 *  the delivery row id, so retries don't need to look anything up. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly config: ConfigService,
    /** Injected for tests; defaults to a logging stub in production. */
    private readonly sesSend: SesSend = defaultSesSend,
  ) {}

  async send(p: EmailPayload): Promise<void> {
    if (this.config.env.SES_FROM_ADDRESS === '') {
      // ponytail: log instead of throw so a misconfigured dev env doesn't
      // crash the worker. Promote to a hard fail once SES is provisioned.
      this.logger.warn(
        `SES_FROM_ADDRESS is empty — sending email in stub mode (to=${p.to}, subject=${p.subject})`,
      );
    }
    await this.sesSend(p);
  }
}
