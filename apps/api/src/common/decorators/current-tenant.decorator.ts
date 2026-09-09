import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';

/**
 * Param decorator that injects the per-request `TenantContext` populated
 * by `TenantContextInterceptor`. Returns `null` when the interceptor
 * passed through (no tenant headers, or `@SkipTenant` route).
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | null => {
    const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>();
    return req.tenant ?? null;
  },
);
