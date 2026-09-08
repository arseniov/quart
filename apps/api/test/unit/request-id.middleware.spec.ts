import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, it, expect } from 'vitest';

import { RequestIdMiddleware } from '../../src/common/request-id.middleware.js';

function makeReq(headers: Record<string, string>) {
  return { headers, id: undefined } as unknown as FastifyRequest;
}

function makeRes() {
  return { header: () => undefined } as unknown as FastifyReply;
}

describe('RequestIdMiddleware', () => {
  it('reuses x-request-id header when present', () => {
    const m = new RequestIdMiddleware();
    const req = makeReq({ 'x-request-id': 'rid-abc-1234' });
    const next = () => {};
    m.use(req, makeRes(), next);
    expect(req.id).toBe('rid-abc-1234');
  });

  it('generates a uuid v4 when header missing', () => {
    const m = new RequestIdMiddleware();
    const req = makeReq({});
    m.use(req, makeRes(), () => {});
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});