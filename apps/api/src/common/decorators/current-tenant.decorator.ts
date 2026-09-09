import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '@quart/shared-types';

/**
 * Factory for `@CurrentTenant`. Hoisted so unit tests can drive it
 * directly; NestJS invokes it with the same `(data, ctx)` shape at
 * decoration time.
 */
export const currentTenantFactory = (
  _data: unknown,
  ctx: ExecutionContext,
): TenantContext | null => {
  const req = ctx.switchToHttp().getRequest<{ tenant?: TenantContext }>();
  return req.tenant ?? null;
};

/**
 * Param decorator that injects the per-request `TenantContext` populated
 * by `TenantContextInterceptor`. Returns `null` when the interceptor
 * passed through (no valid X-City-Id header, or `@SkipTenant` route).
 */
export const CurrentTenant = createParamDecorator(currentTenantFactory);
