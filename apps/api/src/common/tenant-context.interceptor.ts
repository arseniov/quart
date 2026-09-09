import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the Reflector constructor parameter; otherwise
// the APP_INTERCEPTOR provider fails to resolve in `Test.createTestingModule`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { TenantContext } from '@quart/shared-types';
import type { Observable } from 'rxjs';

import { SKIP_TENANT } from './decorators/skip-tenant.decorator.js';

interface RequestWithTenant {
  id?: string;
  headers: Record<string, string | string[] | undefined>;
  tenant?: TenantContext;
}

// Loose UUID regex (matches any 8-4-4-4-12 hex layout). Sufficient for the
// header-based stub — the real auth path will validate via JWT/session.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  // Header names are constants from the caller; not user-controlled keys.
  // eslint-disable-next-line security/detect-object-injection
  const v = headers[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Builds a `TenantContext` from the request-id middleware (`req.id`) and
 * the X-City-Id / X-User-Id / X-Is-Super-Admin headers. Returns `null`
 * when no tenant headers are present (passthrough) or when the only
 * candidate city id is malformed.
 *
 * Phase 3 replaces this with a JwtAuthGuard that populates `req.tenant`
 * before the interceptor runs.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<RequestWithTenant>();
    const tenant = skip ? null : this.buildTenant(req);

    if (tenant) req.tenant = tenant;
    return next.handle();
  }

  private buildTenant(req: RequestWithTenant): TenantContext | null {
    const cityId = headerString(req.headers, 'x-city-id');
    const userIdRaw = headerString(req.headers, 'x-user-id');
    const isSuperAdminRaw = headerString(req.headers, 'x-is-super-admin');

    // No headers at all → passthrough. Downstream falls back to per-controller
    // defaults (or rejects, depending on the route).
    if (!cityId && !userIdRaw && !isSuperAdminRaw) return null;

    // If any UUID-shaped header is present, it must be valid.
    if (cityId && !UUID_RE.test(cityId)) return null;
    if (userIdRaw && !UUID_RE.test(userIdRaw)) return null;

    return {
      cityId: cityId ?? '',
      userId: userIdRaw ?? null,
      isSuperAdmin: isSuperAdminRaw === 'true',
      requestId: req.id ?? '',
    };
  }
}
