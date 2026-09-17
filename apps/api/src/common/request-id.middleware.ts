import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

interface FastifyLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
}
// Both Fastify's Reply.header() and Express's res.setHeader() work here;
// Nest middleware runs through @fastify/middie on the Fastify adapter,
// which hands controllers an Express-style res that only has setHeader.
interface HeaderSetter {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
}

// Reject anything that could pollute logs or escape a header value.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyLikeRequest, res: HeaderSetter, next: () => void): void {
    const fromHeader = req.headers['x-request-id'];
    const candidate = typeof fromHeader === 'string' ? fromHeader : '';
    const requestId = VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    req.id = requestId;
    if (res.header) res.header('x-request-id', requestId);
    else if (res.setHeader) res.setHeader('x-request-id', requestId);
    next();
  }
}
