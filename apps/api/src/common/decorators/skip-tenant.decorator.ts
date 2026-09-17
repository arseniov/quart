import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT = 'skip_tenant';

/**
 * Marks a controller or handler as not requiring tenant context.
 *
 * Used for routes that run before auth is wired (e.g. /health, /login) —
 * the global `TenantContextInterceptor` will leave `req.tenant` unset.
 */
export const SkipTenant = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_TENANT, true);
