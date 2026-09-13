import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { EmailService } from '../../src/queue/email.service.js';

const ENV = { SES_FROM_ADDRESS: '' };

describe('EmailService.send', () => {
  it('forwards the payload to the injected sesSend', async () => {
    const sesSend = vi.fn(async () => undefined);
    const svc = new EmailService({ env: ENV } as never, sesSend);
    await svc.send({
      to: 'a@example.com',
      subject: 's',
      body: 'b',
      notificationId: 'n-1',
      deliveryId: 'd-1',
    });
    expect(sesSend).toHaveBeenCalledOnce();
    expect(sesSend.mock.calls[0]?.[0]).toMatchObject({ to: 'a@example.com', subject: 's', body: 'b' });
  });

  it('logs but does not throw when SES_FROM_ADDRESS is empty (dev mode)', async () => {
    const sesSend = vi.fn(async () => undefined);
    const svc = new EmailService({ env: ENV } as never, sesSend);
    await expect(svc.send({ to: 'a', subject: 's', body: 'b', notificationId: 'n', deliveryId: 'd' })).resolves.toBeUndefined();
    expect(sesSend).toHaveBeenCalledOnce();
  });
});
