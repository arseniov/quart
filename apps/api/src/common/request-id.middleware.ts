import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';

interface FastifyLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
}
interface FastifyLikeReply {
  header(name: string, value: string): unknown;
}

// Reject anything that could pollute logs or escape a header value.
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: FastifyLikeRequest, res: FastifyLikeReply, next: () => void): void {
    const fromHeader = req.headers['x-request-id'];
    const candidate = typeof fromHeader === 'string' ? fromHeader : '';
    const requestId = VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();

    req.id = requestId;
    res.header('x-request-id', requestId);
    next();
  }
}