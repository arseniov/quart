/**
 * Security middleware integration tests.
 *
 * Boots a bare Fastify instance (no Nest, no DB) and exercises the real
 * Fastify body-limit + trustProxy behavior with `app.inject()`. We don't
 * stand up the full Nest app because the only thing under test is the
 * adapter config — no DB / Valkey / Sentry needed.
 *
 * Run with `pnpm --filter @quart/api test:integration`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Fastify security middleware wiring (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Mirrors main.ts: trustProxy defaults to false so a direct exposure
    // won't trust a spoofed X-Forwarded-For from a malicious client.
    app = Fastify({
      trustProxy: false,
      // 1MB cap — the test below posts 2MB and expects a 413.
      bodyLimit: 1024 * 1024,
      logger: false,
    });
    app.post('/json', async (req) => ({ bytes: JSON.stringify(req.body).length }));
    app.get('/ip', async (req) => ({ ip: req.ip }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a JSON body under the bodyLimit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/json' },
      // ~100 KB well under the 1MB cap.
      payload: JSON.stringify({ data: 'x'.repeat(100_000) }),
    });
    expect(res.statusCode).toBe(200);
    // Body was parsed — handler received the JSON, not 413.
    expect(res.json()).toMatchObject({ bytes: expect.any(Number) });
  });

  it('returns 413 when the JSON body exceeds the bodyLimit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/json' },
      // 2 MB stringified JSON payload — twice the 1MB cap.
      payload: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('ignores X-Forwarded-For when trustProxy=false (default)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.statusCode).toBe(200);
    // Spoofed XFF must be ignored — IP should be the loopback / socket
    // peer, NOT '1.2.3.4'.
    expect((res.json() as { ip: string }).ip).not.toBe('1.2.3.4');
  });

  it('honors X-Forwarded-For when trustProxy=true', async () => {
    // Fresh app with trustProxy enabled — mirrors production behind
    // Cloudflare Tunnel / another trusted reverse proxy.
    const trusted = Fastify({ trustProxy: true, logger: false });
    trusted.get('/ip', async (req) => ({ ip: req.ip }));
    await trusted.ready();
    try {
      const res = await trusted.inject({
        method: 'GET',
        url: '/ip',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ip: string }).ip).toBe('1.2.3.4');
    } finally {
      await trusted.close();
    }
  });
});
