import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * Placeholder for Phase 5 — controllers will call auditService.write(req.tenantTx, ev)
 * inside the same transaction as the action; this interceptor no-ops until the
 * @Audit() decorator + tenantTx flow lands.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}