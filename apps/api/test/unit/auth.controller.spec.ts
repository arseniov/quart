import { describe, it, expect, vi } from 'vitest';

import { AuthController } from '../../src/auth/auth.controller.js';
import type { AuthService } from '../../src/auth/auth.service.js';

describe('AuthController', () => {
  it('forwards multi-value Set-Cookie as a single array call', async () => {
    const cookie1 = '__Host-quart-api-session=abc; HttpOnly';
    const cookie2 = '__Host-quart-api-state=xyz; HttpOnly';

    const mockAuth = {
      instance: {
        handler: async () =>
          new Response(null, {
            status: 200,
            headers: [
              ['content-type', 'text/plain'],
              ['set-cookie', cookie1],
              ['set-cookie', cookie2],
            ],
          }),
      },
    } as unknown as AuthService;

    const header = vi.fn();
    const status = vi.fn();
    const send = vi.fn();
    const mockRes = { header, status, send };

    const controller = new AuthController(mockAuth);
    await controller.handle(
      { method: 'POST', params: { '*': 'callback' }, headers: {}, body: {} } as never,
      mockRes as never,
    );

    expect(status).toHaveBeenCalledWith(200);
    const setCookieCall = header.mock.calls.find(([k]) => k === 'set-cookie');
    expect(setCookieCall).toBeDefined();
    expect(setCookieCall?.[1]).toEqual([cookie1, cookie2]);
    // Exactly one set-cookie call — never two, which would clobber.
    expect(header.mock.calls.filter(([k]) => k === 'set-cookie')).toHaveLength(1);
  });
});