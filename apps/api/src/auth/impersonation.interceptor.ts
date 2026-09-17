import { Injectable, ForbiddenException, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { type Observable } from 'rxjs';

import { parseImpersonationHeader } from './decorators/impersonation.decorator.js';

@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const imp = parseImpersonationHeader(req.headers['x-quart-impersonation']);
    if (!imp) return next.handle();
    if (imp.expiresAt * 1000 < Date.now()) {
      throw new ForbiddenException({ error: { code: 'impersonation.expired', message: 'Impersonation envelope expired' } });
    }
    const user = (req as unknown as { user?: { id: string; isSuperAdmin?: boolean } }).user;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException({ error: { code: 'impersonation.forbidden', message: 'Not super admin' } });
    }
    (req as unknown as { onBehalfOfUserId: string }).onBehalfOfUserId = imp.targetUserId;
    return next.handle();
  }
}
